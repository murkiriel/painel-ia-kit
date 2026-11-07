// Cada dashboard tem os próprios dados, e eles nunca se misturam. A separação é do banco, não só das pastas:
//  - Postgres: um schema por dashboard, e usuários de leitura e de carga que só têm permissão no schema dele;
//  - SQLite: um arquivo por dashboard, aberto sozinho, com ATTACH proibido.
// Os testes usam dois dashboards de exemplo com a mesma estrutura do dashboard de produção, dados diferentes e nenhum dado real.
// O Postgres é um embedded-postgres descartável, em pasta temporária. Se ele não puder subir, os testes dele ficam pulados, com o motivo.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import pg from "pg";
import { createSqliteFile, openSqlite, writeRows } from "../server/db/sqlite.ts";
import { answer } from "../server/agent/agent.ts";
import { loaderAccess, loaderRole, readerAccess, readerRole, type DashboardDb } from "../server/db/open.ts";
import type { Db } from "../server/db/types.ts";
import { DASHBOARDS } from "../server/dashboards.ts";
import { TOOLS, type AgentContext } from "../dashboards/producao-agricola/agent/tools.ts";
import { SYSTEM_PROMPT } from "../dashboards/producao-agricola/agent/prompt.ts";
import { simulatedModel } from "../dashboards/producao-agricola/agent/simulatedModel.ts";
import { DB as PRODUCTION } from "../dashboards/producao-agricola/db.ts";
import { NO_FILTERS } from "../dashboards/producao-agricola/domain/filters.ts";
import { createQueries } from "../dashboards/producao-agricola/domain/queries.ts";

const dir = mkdtempSync(path.join(tmpdir(), "dash-isolation-"));
const PRODUCTION_SQL = (name: string) => readFileSync(new URL(`../dashboards/producao-agricola/sql/${name}`, import.meta.url), "utf8");

/** Dois dashboards com a estrutura do de produção. Só o nome muda. */
const A: DashboardDb = { ...PRODUCTION, slug: "iso-a", schema: "iso_a" };
const B: DashboardDb = { ...PRODUCTION, slug: "iso-b", schema: "iso_b" };
const VALUE = { [A.slug]: "111.00", [B.slug]: "777.00" } as Record<string, string>;

const row = (value: string) => ({
  year: 2024, state_code: "41", state_name: "Paraná", region: "Sul", crop_code: "1", crop_name: "Soja", value_brl: value, quantity_t: "1.000", quantity_unit: "t", area_ha: "1.000",
});
const LOG = { entity: "teste", started_at: "2026-10-30T10:00:00.000Z", finished_at: "2026-10-30T10:01:00.000Z", status: "ok" };

/** O agente do dashboard, com as ferramentas e a conexão dele, perguntando "o valor por estado". */
async function ask(reader: Db, question = "Qual o valor por estado?") {
  const ctx: AgentContext = { filters: { ...NO_FILTERS, year: 2024 }, yearIsDefault: true, scope: ["41"], data: createQueries(reader) };
  return answer(question, ctx, simulatedModel, { systemPrompt: SYSTEM_PROMPT, tools: TOOLS });
}

// ---------------------------------------------------------------------------------------------------------------------
// SQLite: um arquivo por dashboard

const sqliteFileOf = (db: DashboardDb) => path.join(dir, `${db.slug}.sqlite`);
const sqliteReader = (db: DashboardDb) => openSqlite(sqliteFileOf(db), readerAccess(db));

before(() => {
  for (const db of [A, B]) {
    createSqliteFile(sqliteFileOf(db), { sql: [fileURLToPath(new URL("../dashboards/producao-agricola/sql/sqlite_schema.sql", import.meta.url))] });
    const admin = openSqlite(sqliteFileOf(db), null);
    const handle = admin.handle();
    handle.exec("BEGIN");
    writeRows(handle, "production", [row(VALUE[db.slug])]);
    writeRows(handle, "load_log", [LOG]);
    handle.exec("COMMIT");
    handle.close();
  }
});

test("SQLite: cada conexão abre só o arquivo do dashboard, e ATTACH do arquivo do outro é recusado", async () => {
  const reader = sqliteReader(A);
  assert.equal((await reader.query("SELECT value_brl FROM production")).rows.length, 1);
  const other = sqliteFileOf(B).replaceAll("\\", "/");
  for (const sql of [`ATTACH DATABASE '${other}' AS outro`, `ATTACH '${other}' AS outro`, `ATTACH DATABASE ':memory:' AS memoria`]) {
    await assert.rejects(reader.query(sql), /not authorized|prohibited|too many attached|authorization denied/, sql);
  }
  // Sem o ATTACH, o outro arquivo nem tem nome nesta conexão.
  await assert.rejects(reader.query("SELECT * FROM outro.production"), /no such table|not authorized|unknown database|sem as tabelas/);
  await reader.end();

  const loader = openSqlite(sqliteFileOf(A), loaderAccess(A));
  await assert.rejects(loader.query(`ATTACH DATABASE '${other}' AS outro`), /not authorized|prohibited|too many attached|authorization denied/);
  await loader.end();
});

test("SQLite: a carga de um dashboard só grava no arquivo dele", async () => {
  const before = readFileSync(sqliteFileOf(B));
  const loader = openSqlite(sqliteFileOf(A), loaderAccess(A));
  await loader.query("UPDATE production SET value_brl = 0");
  await loader.end();
  assert.deepEqual(readFileSync(sqliteFileOf(B)), before, "o arquivo do outro mudou");
  const reader = sqliteReader(A);
  assert.equal((await reader.query("SELECT dec_text(value_brl, 'value_brl') AS v FROM production")).rows[0].v, "0.00");
  await reader.end();
  // Devolve o valor para os testes seguintes.
  const admin = openSqlite(sqliteFileOf(A), null);
  admin.handle().exec("UPDATE production SET value_brl = 11100");
  await admin.end();
});

test("SQLite: o agente de um dashboard só enxerga os dados dele", async () => {
  const [readerA, readerB] = [sqliteReader(A), sqliteReader(B)];
  const fromA = await ask(readerA);
  const fromB = await ask(readerB);
  assert.equal(fromA.status, "answered");
  assert.match(fromA.text, /R\$ 111\b/);
  assert.doesNotMatch(fromA.text, /777/);
  assert.match(fromB.text, /R\$ 777\b/);
  assert.doesNotMatch(fromB.text, /111/);
  await readerA.end();
  await readerB.end();
});

// ---------------------------------------------------------------------------------------------------------------------
// Postgres: um schema por dashboard, e usuários que só enxergam o schema dele

let postgres: { reader: (db: DashboardDb) => Db; loader: (db: DashboardDb) => pg.Client; admin: pg.Client; stop: () => Promise<void> } | null = null;
let skipReason = "";

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});

before(async () => {
  try {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const port = await freePort();
    const password = randomBytes(12).toString("hex");
    const server = new EmbeddedPostgres({
      databaseDir: path.join(dir, "postgres"), user: "teste", password, port, persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
    });
    await server.initialise();
    await server.start();
    await server.createDatabase("iso");
    const admin = new pg.Client({ host: "127.0.0.1", port, user: "teste", password, database: "iso" });
    await admin.connect();
    const secrets: Record<string, string> = {};
    const grants = PRODUCTION_SQL("002_grants.sql");
    for (const db of [A, B]) {
      await admin.query(`CREATE SCHEMA ${db.schema}`);
      await admin.query(`SET search_path = ${db.schema}`);
      await admin.query(PRODUCTION_SQL("001_schema.sql"));
      for (const role of [readerRole(db), loaderRole(db)]) {
        secrets[role] = randomBytes(12).toString("hex");
        await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${secrets[role]}'`);
      }
      // Os mesmos GRANTs do dashboard de produção, com o nome do schema e dos usuários trocado.
      await admin.query(grants.replaceAll("producao_agricola", db.schema));
      await admin.query("INSERT INTO production (year, state_code, state_name, region, crop_code, crop_name, value_brl, quantity_t, quantity_unit, area_ha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", Object.values(row(VALUE[db.slug])));
      await admin.query("INSERT INTO load_log (entity, started_at, finished_at, status) VALUES ('teste', $1, $2, 'ok')", [LOG.started_at, LOG.finished_at]);
    }
    // SABOTAR_ISOLAMENTO=1 dá ao leitor de A permissão no schema de B: os testes do Postgres precisam reprovar.
    if (process.env.SABOTAR_ISOLAMENTO) await admin.query(`GRANT USAGE ON SCHEMA iso_b TO ${readerRole(A)}; GRANT SELECT ON ALL TABLES IN SCHEMA iso_b TO ${readerRole(A)}`);
    await admin.query("CREATE SCHEMA portal");
    await admin.query("SET search_path = portal");
    await admin.query(readFileSync(new URL("../server/sql/portal_schema.sql", import.meta.url), "utf8"));
    await admin.query("RESET search_path");
    const config = (role: string, db: DashboardDb) => ({ host: "127.0.0.1", port, user: role, password: secrets[role], database: "iso", options: `-c search_path=${db.schema}` });
    const pools: pg.Pool[] = [];
    postgres = {
      reader: (db) => {
        const pool = new pg.Pool(config(readerRole(db), db));
        pools.push(pool);
        return pool as unknown as Db;
      },
      loader: (db) => new pg.Client(config(loaderRole(db), db)),
      admin,
      stop: async () => {
        await Promise.allSettled(pools.map((pool) => pool.end()));
        await admin.end();
        await server.stop();
      },
    };
  } catch (error) {
    skipReason = `o Postgres descartável não subiu: ${error instanceof Error ? error.message : error}`;
  }
}, { timeout: 120_000 });

after(async () => {
  await postgres?.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const needsPostgres = (name: string, body: () => Promise<void>) => test(name, async (t) => {
  if (skipReason) return t.skip(skipReason);
  await body();
});
const DENIED = /permission denied/;

needsPostgres("Postgres: a leitura de um dashboard é recusada pelo banco ao ler o schema do outro e o do portal", async () => {
  const reader = postgres!.reader(A);
  assert.equal((await reader.query("SELECT value_brl::text AS v FROM production")).rows[0].v, "111.00");
  // Pelo nome do schema, e trocando o caminho de busca: nos dois casos o banco recusa.
  await assert.rejects(reader.query("SELECT * FROM iso_b.production"), DENIED);
  await assert.rejects(reader.query("SELECT * FROM iso_b.load_log"), DENIED);
  // Sem permissão no schema, o Postgres nem o procura: a tabela "não existe" para quem pergunta.
  await assert.rejects(reader.query("SET search_path = iso_b; SELECT * FROM production"), /permission denied|does not exist/);
  await assert.rejects(reader.query("SELECT * FROM portal.app_user"), DENIED);
  await assert.rejects(reader.query("SELECT * FROM portal.app_session"), DENIED);
  // E o inverso.
  const readerB = postgres!.reader(B);
  assert.equal((await readerB.query("SELECT value_brl::text AS v FROM production")).rows[0].v, "777.00");
  await assert.rejects(readerB.query("SELECT * FROM iso_a.production"), DENIED);
});

needsPostgres("Postgres: a carga de um dashboard não grava no schema do outro, e a leitura não grava em lugar nenhum", async () => {
  const loader = postgres!.loader(A);
  await loader.connect();
  try {
    await loader.query("UPDATE production SET value_brl = value_brl");
    for (const sql of [
      "INSERT INTO iso_b.production (year, state_code, state_name, region, crop_code, crop_name, quantity_unit) VALUES (1, 'x', 'x', 'x', 'x', 'x', 't')",
      "UPDATE iso_b.production SET value_brl = 0",
      "DELETE FROM iso_b.production",
      "TRUNCATE iso_b.production",
      "SELECT * FROM iso_b.production",
      "DROP TABLE iso_b.production",
      "CREATE TABLE iso_b.intruso (id int)",
      "INSERT INTO portal.app_user (login, name, pass_hash, pass_salt) VALUES ('x', 'x', 'x', 'x')",
    ]) {
      await assert.rejects(loader.query(sql), /permission denied|must be owner/, sql);
    }
  } finally {
    await loader.end();
  }
  const reader = postgres!.reader(A);
  for (const sql of ["UPDATE production SET value_brl = 0", "DELETE FROM production", "INSERT INTO iso_a.load_log (entity, started_at, status) VALUES ('x', now(), 'ok')"]) {
    await assert.rejects(reader.query(sql), DENIED, sql);
  }
  const { rows } = await postgres!.admin.query("SELECT value_brl::text AS v FROM iso_b.production");
  assert.equal(rows[0].v, "777.00");
});

needsPostgres("Postgres: o agente de um dashboard só enxerga os dados dele", async () => {
  const fromA = await ask(postgres!.reader(A));
  const fromB = await ask(postgres!.reader(B));
  assert.equal(fromA.status, "answered");
  assert.match(fromA.text, /R\$ 111\b/);
  assert.doesNotMatch(fromA.text, /777/);
  assert.match(fromB.text, /R\$ 777\b/);
  assert.doesNotMatch(fromB.text, /111/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Varredura: as consultas de cada dashboard só citam o schema dele

const SOURCE_DIRS = ["domain", "load", "agent", "sql"];

/** Arquivos que carregam, consultam ou perguntam: tudo de um dashboard que fala com o banco. Telas e provas ficam de fora. */
function sourceFiles(root: string): string[] {
  const walk = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const file = path.join(folder, name);
      if (statSync(file).isDirectory()) return walk(file);
      return /\.(ts|sql)$/.test(name) ? [file] : [];
    });
  return SOURCE_DIRS.flatMap((name) => walk(path.join(root, name)));
}

const QUALIFIED = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi;

/** O que um dashboard cita que não é dele: outro schema, o portal, ou qualquer tabela com prefixo. */
export function foreignReferences(text: string, own: DashboardDb, all: DashboardDb[]): string[] {
  const found: string[] = [];
  for (const other of all.filter((db) => db.schema !== own.schema)) {
    for (const name of [other.schema, other.slug, dashboardWord(other)]) if (name && text.includes(name)) found.push(`cita ${name}`);
  }
  for (const word of ["portal.", "public.", "app_user", "app_session", "dashboard_access"]) if (text.includes(word)) found.push(`cita ${word}`);
  for (const match of text.matchAll(QUALIFIED)) if (match[1] !== "pg_catalog" && match[1] !== "information_schema") found.push(`tabela com prefixo: ${match[0]}`);
  return found;
}
const dashboardWord = (db: DashboardDb) => db.schema.toUpperCase();

test("varredura: as consultas, a carga e o agente de cada dashboard só citam o schema dele", () => {
  const all = DASHBOARDS.map((dashboard) => dashboard.db);
  assert.ok(all.length >= 1);
  for (const dashboard of DASHBOARDS) {
    const root = path.join("dashboards", dashboard.slug);
    const files = sourceFiles(root);
    assert.ok(files.some((file) => file.endsWith("queries.ts") || file.endsWith(".sql")), `a varredura de ${dashboard.slug} não achou arquivos`);
    for (const file of files) {
      const found = foreignReferences(readFileSync(file, "utf8"), dashboard.db, all);
      assert.deepEqual(found, [], `${file}`);
    }
  }
});

test("varredura: pega de verdade — citar outro dashboard, o portal ou uma tabela com prefixo reprova", () => {
  const all = [A, B];
  const bad = [
    "SELECT * FROM iso_b.production",
    "SELECT 1 FROM production JOIN portal.app_user ON true",
    "INSERT INTO public.production VALUES (1)",
    "const slug = 'iso-b';",
    "SELECT * FROM app_session",
    "UPDATE meu_schema.production SET x = 1",
  ];
  for (const text of bad) assert.notDeepEqual(foreignReferences(text, A, all), [], text);
  assert.deepEqual(foreignReferences("SELECT year FROM production WHERE state_code = ANY($5::text[])", A, all), []);
});
