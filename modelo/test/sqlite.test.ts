// O SQLite por dentro: contas, travas de leitura, login, carga e falhas. Sem rede, dado real ou credencial.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { createAuth, grantedScope, hashPassword } from "../server/auth.ts";
import { divide, inPortuguese, scaledText, sortKey, toScaled } from "../server/db/decimal.ts";
import { openAuth, openPortal, readEngine, readerAccess, sqliteFile } from "../server/db/open.ts";
import { createSqliteFile, openSqlite, toSqlite, writeRows } from "../server/db/sqlite.ts";
import { DatabaseUnavailable } from "../server/db/types.ts";
import { producaoAgricola } from "../dashboards/producao-agricola/dashboard.ts";
import { DB } from "../dashboards/producao-agricola/db.ts";
import { ALL_STATES, SCOPE } from "../dashboards/producao-agricola/domain/filters.ts";
import { createQueries } from "../dashboards/producao-agricola/domain/queries.ts";
import { prepareLoad } from "../dashboards/producao-agricola/load/prepare.ts";
import { sqliteStore } from "../dashboards/producao-agricola/load/store.ts";
import type { SidraRow } from "../dashboards/producao-agricola/load/sidra.ts";

const dir = mkdtempSync(path.join(tmpdir(), "dash-sqlite-test-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
let serial = 0;
const newFile = () => path.join(dir, `banco-${++serial}.sqlite`);

/** O arquivo do dashboard de produção e o do portal são arquivos diferentes: as travas de um não valem para o outro. */
const createDashboardFile = (file: string) => createSqliteFile(file, producaoAgricola.sqlite({}));
const readerOf = (file: string) => openSqlite(file, readerAccess(DB));

const ROW = { year: 2024, state_code: "51", state_name: "Mato Grosso", region: "Centro-Oeste", crop_code: "1", crop_name: "Soja", value_brl: "100.50", quantity_t: "2.500", quantity_unit: "t", area_ha: "1.000" };

function filled() {
  const file = newFile();
  createDashboardFile(file);
  const db = new DatabaseSync(file);
  writeRows(db, "production", [ROW, { ...ROW, state_code: "35", state_name: "São Paulo", region: "Sudeste" }]);
  db.close();
  return file;
}

test("motor: vazio é Postgres, e valor desconhecido é recusado, com o motivo", () => {
  assert.equal(readEngine(undefined), "postgres");
  assert.equal(readEngine(""), "postgres");
  assert.equal(readEngine("postgres"), "postgres");
  assert.equal(readEngine("sqlite"), "sqlite");
  for (const value of ["SQLITE", "Postgres", "mysql", " sqlite"]) assert.throws(() => readEngine(value), /DB_ENGINE inválido/);
});

test("motor desconhecido impede o servidor de subir e diz por quê", () => {
  const started = spawnSync(process.execPath, ["server/main.ts"], { windowsHide: true, env: { ...process.env, DB_ENGINE: "oracle", AUTH_MODE: "local" }, encoding: "utf8", timeout: 30_000 });
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /DB_ENGINE inválido/);
});

test("dinheiro entra como inteiro e sai com o mesmo texto do NUMERIC", () => {
  assert.equal(toScaled("1234.5", 2), 123450n);
  assert.equal(toScaled("-0.01", 2), -1n);
  assert.equal(toScaled("7", 3), 7000n);
  assert.equal(toScaled(null, 2), null);
  assert.equal(scaledText(123450n, 2), "1234.50");
  assert.equal(scaledText(-1n, 2), "-0.01");
  assert.equal(scaledText(0n, 3), "0.000");
  assert.equal(scaledText(5n, 0), "5");
});

test("casa decimal a mais, valor além do limite ou texto estranho recusam a linha, sem arredondar", () => {
  assert.throws(() => toScaled("1.005", 2), /mais de 2 casas/);
  assert.equal(toScaled("1.500", 2), 150n);
  assert.throws(() => toScaled("92233720368547758.08", 2), /não cabe/);
  assert.equal(toScaled("92233720368547758.07", 2), 9_223_372_036_854_775_807n);
  assert.throws(() => toScaled("1,5", 2), /inválido/);
  assert.throws(() => toScaled("1e5", 2), /inválido/);
});

test("divisão com a escala e o arredondamento do Postgres", () => {
  const text = (a: bigint, b: bigint, scale: number) => {
    const result = divide(a, b, scale);
    return scaledText(result.quotient, result.scale);
  };
  // Conferidos no Postgres 18: SELECT (a::numeric(20,2) / b::numeric(20,2))::text.
  assert.equal(text(10000n, 30000n, 2), "0.33333333333333333333");
  assert.equal(text(20000n, 30000n, 2), "0.66666666666666666667");
  assert.equal(text(30000n, 10000n, 2), "3.0000000000000000");
  assert.equal(text(0n, 30000n, 2), "0.00000000000000000000");
  assert.equal(text(-10000n, 30000n, 2), "-0.33333333333333333333");
  assert.equal(text(100n, 10000000000000n, 2), "0.0000000000100000000000000000");
  assert.equal(text(10000000000000n, 100n, 2), "100000000000.00000000");
});

test("a chave de ordem acompanha o número, com negativo e além de 64 bits", () => {
  const values = [-(10n ** 30n), -5n, -1n, 0n, 1n, 9n, 10n, 9_223_372_036_854_775_807n, 9_223_372_036_854_775_808n, 10n ** 30n];
  const keys = values.map(sortKey);
  assert.deepEqual([...keys].sort(), keys);
  assert.throws(() => sortKey(10n ** 60n), /grande demais/);
});

test("ordem de dicionário sem ICU no banco", () => {
  assert.deepEqual(inPortuguese(["Paraná", "Paraíba", "Pará", "Rondônia", "Acre", "Ácido", "Açaí", "Abacate", "Erva-mate", "Erva doce"]),
    ["Abacate", "Açaí", "Ácido", "Acre", "Erva doce", "Erva-mate", "Pará", "Paraíba", "Paraná", "Rondônia"]);
});

test("a tradução do SQL só troca filtro opcional, parâmetro e lista, e o resto chega como veio", () => {
  const sql = "($1::int IS NULL OR year = $1::int) AND ($2::text IS NULL OR p.region = $2::text) AND state_code = ANY($5::text[]) AND $6::int IS NULL";
  assert.equal(toSqlite(sql, [2024, null]), "year = $1 AND 1 AND state_code IN (SELECT value FROM json_each($5)) AND $6 IS NULL");
  assert.equal(toSqlite(sql, [null, "Sul"]), "1 AND p.region = $2 AND state_code IN (SELECT value FROM json_each($5)) AND $6 IS NULL");
  assert.equal(toSqlite("COUNT(*)::int AS n"), "COUNT(*) AS n");
  assert.equal(toSqlite("SUM(a)::text"), "SUM(a)::text");
});

test("soma além do inteiro de 64 bits, sem o erro do SUM do SQLite", async () => {
  const file = newFile();
  createDashboardFile(file);
  const db = new DatabaseSync(file);
  const big = "90000000000000000.00";
  writeRows(db, "production", [{ ...ROW, value_brl: big }, { ...ROW, state_code: "35", value_brl: big }, { ...ROW, state_code: "41", value_brl: "-0.01" }]);
  assert.throws(() => db.prepare("SELECT SUM(value_brl) FROM production").get(), /overflow/);
  db.close();
  const reader = readerOf(file);
  const summary = await createQueries(reader).summary({ year: 2024, region: null, state: null, crop: null }, ALL_STATES);
  assert.equal(summary.value, "179999999999999999.99");
  await reader.end();
});

test("a conexão de leitura não grava: nem pelo arquivo, nem pela conexão", async () => {
  const file = filled();
  const bytes = () => [file, `${file}-wal`].map((name) => { try { return readFileSync(name).toString("hex"); } catch { return ""; } }).join();

  // Primeira trava, sozinha: o arquivo aberto somente para leitura.
  const plain = new DatabaseSync(file, { readOnly: true });
  for (const sql of ["INSERT INTO load_log (entity, started_at, status) VALUES ('x', 'x', 'ok')", "UPDATE production SET value_brl = 0", "DELETE FROM production", "DROP TABLE production", "CREATE TABLE teste (id INTEGER)"]) {
    assert.throws(() => plain.exec(sql), /readonly/, sql);
  }
  plain.close();

  // A conexão que o servidor usa: as duas travas juntas, e nada de outras tabelas.
  const reader = readerOf(file);
  const before = bytes();
  for (const sql of [
    "INSERT INTO production (year) VALUES (1)", "UPDATE production SET value_brl = 0", "DELETE FROM production", "DROP TABLE production", "CREATE TABLE teste (id INTEGER)",
    "CREATE TEMP TABLE teste (id INTEGER)", "CREATE INDEX i ON production (year)", "ALTER TABLE production ADD COLUMN x INTEGER", "ATTACH DATABASE 'x.sqlite' AS x",
    "PRAGMA query_only = OFF", "PRAGMA writable_schema = ON", "VACUUM", "BEGIN IMMEDIATE",
  ]) {
    await assert.rejects(reader.query(sql), /readonly|not authorized|authorization denied|prohibited|too many attached/, sql);
  }
  // As tabelas do portal moram em outro arquivo: neste, elas nem existem.
  await assert.rejects(reader.query("SELECT * FROM app_user"), /no such table|prohibited|sem as tabelas/);
  await assert.rejects(reader.query("SELECT * FROM app_session"), /no such table|prohibited|sem as tabelas/);
  await assert.rejects(reader.query("SELECT * FROM dashboard_access"), /no such table|prohibited|sem as tabelas/);
  await assert.rejects(reader.query("SELECT * FROM raw_production"), /prohibited/);
  await assert.rejects(reader.query("SELECT sql FROM sqlite_master"), /prohibited/);
  assert.equal(bytes(), before);
  assert.equal((await reader.query("SELECT COUNT(*) AS n FROM production")).rows[0].n, 2);

  // A mesma conexão, tirando as travas uma a uma: cada uma segura sozinha.
  const db = reader.handle();
  db.setAuthorizer(null);
  assert.throws(() => db.exec("CREATE TEMP TABLE teste (id INTEGER)"), /readonly/, "query_only");
  assert.throws(() => db.exec("DELETE FROM production"), /readonly/, "query_only");
  db.exec("PRAGMA query_only = OFF");
  assert.throws(() => db.exec("DELETE FROM production"), /readonly/, "arquivo somente para leitura");
  assert.throws(() => db.exec("DROP TABLE production"), /readonly/, "arquivo somente para leitura");
  assert.equal(bytes(), before);
  await reader.end();
});

test("parâmetro nunca vira SQL", async () => {
  const reader = readerOf(filled());
  const queries = createQueries(reader);
  for (const attack of ["x' OR '1'='1", "'; DROP TABLE production; --", "$1", "1) OR (1=1"]) {
    assert.equal((await queries.byState({ year: null, region: attack, state: null, crop: null }, ALL_STATES)).rows.length, 0);
    assert.equal((await queries.byState({ year: null, region: null, state: null, crop: null }, [attack])).rows.length, 0);
  }
  assert.equal((await queries.byState({ year: null, region: null, state: null, crop: null }, ALL_STATES)).rows.length, 2);
  await reader.end();
});

/** O arquivo do portal, e as conexões do servidor apontadas para ele por SQLITE_DIR. */
function portalFiles() {
  const folder = mkdtempSync(path.join(dir, "portal-"));
  process.env.DB_ENGINE = "sqlite";
  process.env.SQLITE_DIR = folder;
  const file = sqliteFile("portal");
  createSqliteFile(file, { sql: ["server/sql/sqlite_portal_schema.sql"] });
  return file;
}

test("a conexão de login só toca nas próprias tabelas, e a do portal não toca em dados", async () => {
  const file = portalFiles();
  const auth = await openAuth();
  const portal = await openPortal();
  const admin = new DatabaseSync(file);
  admin.prepare("INSERT INTO app_user (id, login, name, pass_hash, pass_salt) VALUES (1, 'a', 'a', 'h', 's')").run();
  admin.prepare("INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES (1, 'producao-agricola', 0, '[\"51\"]')").run();
  admin.close();
  for (const sql of [
    "UPDATE app_user SET name = 'x'", "DELETE FROM app_user", "INSERT INTO app_user (login, name, pass_hash, pass_salt) VALUES ('b', 'b', 'h', 's')",
    "UPDATE app_session SET csrf = 'x'", "DROP TABLE app_session", "PRAGMA foreign_keys = OFF",
    "INSERT INTO dashboard_access (user_id, dashboard) VALUES (1, 'x')", "UPDATE dashboard_access SET full_access = 1", "DELETE FROM dashboard_access",
  ]) {
    await assert.rejects(auth.query(sql), /not authorized|prohibited/, sql);
  }
  assert.equal((await auth.query("SELECT login FROM app_user")).rows[0].login, "a");
  assert.equal((await auth.query("SELECT dashboard FROM dashboard_access")).rows[0].dashboard, "producao-agricola");
  await auth.query("INSERT INTO app_session (token, csrf, user_id, expires_at) VALUES ('t', 'c', 1, '2099')");
  await auth.query("DELETE FROM app_session WHERE token = 't'");

  // A administração do portal cria e altera pessoas e acessos, mas não cria sessão, não apaga pessoa e não mexe no esquema.
  for (const sql of ["INSERT INTO app_session (token, csrf, user_id, expires_at) VALUES ('t', 'c', 1, '2099')", "DELETE FROM app_user", "DROP TABLE app_user", "ATTACH DATABASE 'x.sqlite' AS x", "PRAGMA writable_schema = ON"]) {
    await assert.rejects(portal.query(sql), /not authorized|prohibited|too many attached/, sql);
  }
  await portal.query("UPDATE app_user SET active = $2 WHERE id = $1", [1, false]);
  assert.equal((await portal.query("SELECT active FROM app_user WHERE id = 1")).rows[0].active, 0);
  await auth.end();
  await portal.end();
});

const response = () => {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (name: string, value: string) => void (headers[name] = value) } as unknown as ServerResponse & { headers: Record<string, string> };
};
const request = (cookie: string) => ({ headers: { cookie } }) as never;

test("login em SQLite: senha, sessão, permissão por dashboard, desativada, vencimento, saída e bloqueio", async () => {
  portalFiles();
  const admin = openSqlite(sqliteFile("portal"), null);
  const { hash, salt } = hashPassword("segredo-de-teste");
  const add = "INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin, active, must_change_password) VALUES ($1, $1, $2, $3, $4, $5, $6) RETURNING id";
  const ids: Record<string, string> = {};
  for (const [login, isAdmin, active, provisional] of [["mt", false, true, false], ["total", false, true, false], ["vazio", false, true, false], ["admin", true, true, false], ["inativo", false, false, false], ["provisorio", false, true, true]] as const) {
    ids[login] = String((await admin.query(add, [login, hash, salt, isAdmin, active, provisional])).rows[0].id);
  }
  const grant = "INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, 'producao-agricola', $2, $3)";
  await admin.query(grant, [ids.mt, false, ["51"]]);
  await admin.query(grant, [ids.total, true, []]);
  const auth = createAuth(await openAuth(), await openPortal(), false);
  const res = response();
  const dashboard = { scope: SCOPE };

  assert.equal(await auth.login("mt", "errada", "1.1.1.1", res), null);
  assert.equal(await auth.login("ninguem", "errada", "1.1.1.1", res), null);
  // Pessoa desativada recebe a mesma resposta de senha errada, mesmo com a senha certa.
  assert.equal(await auth.login("inativo", "segredo-de-teste", "1.1.1.1", res), null);
  const session = await auth.login("mt", "segredo-de-teste", "1.1.1.1", res);
  assert.ok(session && session !== "blocked");
  assert.equal(session.user.isAdmin, false);
  assert.deepEqual(grantedScope(dashboard, (await auth.access(session.user.id))["producao-agricola"]), ["51"]);
  assert.match(res.headers["Set-Cookie"], /HttpOnly; SameSite=Lax/);

  const again = await auth.session(request(`dash_session=${session.token}`));
  assert.equal(again?.csrf, session.csrf);
  assert.equal(await auth.session(request("dash_session=inventado")), null);

  const total = await auth.login("total", "segredo-de-teste", "1.1.1.1", response());
  assert.ok(total && total !== "blocked");
  assert.deepEqual(grantedScope(dashboard, (await auth.access(total.user.id))["producao-agricola"]), ALL_STATES);
  const none = await auth.login("vazio", "segredo-de-teste", "1.1.1.1", response());
  assert.ok(none && none !== "blocked");
  assert.deepEqual(await auth.access(none.user.id), {});
  const boss = await auth.login("admin", "segredo-de-teste", "1.1.1.1", response());
  assert.ok(boss && boss !== "blocked");
  assert.equal(boss.user.isAdmin, true);
  const temporary = await auth.login("provisorio", "segredo-de-teste", "1.1.1.1", response());
  assert.ok(temporary && temporary !== "blocked");
  assert.equal(temporary.user.mustChangePassword, true);

  // Desativar derruba a sessão que já existia.
  await admin.query("UPDATE app_user SET active = 0 WHERE id = $1", [ids.vazio]);
  assert.equal(await auth.session(request(`dash_session=${none.token}`)), null);

  await admin.query("UPDATE app_session SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token = $1", [total.token]);
  assert.equal(await auth.session(request(`dash_session=${total.token}`)), null);
  // O login seguinte limpa as sessões vencidas.
  await auth.login("mt", "segredo-de-teste", "1.1.1.1", response());
  assert.equal((await admin.query("SELECT 1 FROM app_session WHERE token = $1", [total.token])).rows.length, 0);

  await auth.logout(session, response());
  assert.equal(await auth.session(request(`dash_session=${session.token}`)), null);

  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) blocked = (await auth.login("mt", "errada", "2.2.2.2", response())) === "blocked";
  assert.equal(blocked, true);
  await admin.end();
});

test("arquivo ausente, sem tabelas ou inválido: mensagem em português, sem caminho", async () => {
  const missing = readerOf(path.join(dir, "nao-existe.sqlite"));
  const empty = path.join(dir, "vazio.sqlite");
  writeFileSync(empty, "");
  const invalid = path.join(dir, "invalido.sqlite");
  writeFileSync(invalid, "isto não é um banco de dados, mas um texto comprido o bastante");
  for (const [file, message] of [["nao-existe.sqlite", /ainda não foi criado/], ["vazio.sqlite", /sem as tabelas/], ["invalido.sqlite", /não pôde ser lido/]] as const) {
    const reader = readerOf(path.join(dir, file));
    const original = console.error;
    console.error = () => {};
    try {
      await assert.rejects(reader.query("SELECT 1 FROM production"), (error: Error) => {
        assert.ok(error instanceof DatabaseUnavailable);
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, new RegExp(file));
        assert.doesNotMatch(error.message, /sqlite|SELECT/i);
        return true;
      });
    } finally {
      console.error = original;
    }
    await reader.end();
  }
  await missing.end();
  // Abrir nunca cria o arquivo: quem cria é o npm run db.
  assert.throws(() => readFileSync(path.join(dir, "nao-existe.sqlite")));
});

test("depois da carga, a conexão funciona sem reiniciar", async () => {
  const file = newFile();
  const reader = readerOf(file);
  await assert.rejects(reader.query("SELECT 1 FROM production"), DatabaseUnavailable);
  copyFileSync(filled(), file);
  assert.equal((await reader.query("SELECT COUNT(*) AS n FROM production")).rows[0].n, 2);
  await reader.end();
});

test("criar por cima de um banco existente é recusado", () => {
  assert.throws(() => createDashboardFile(filled()), /já existe/);
});

const STATE_ROWS = (year: number, value: string): SidraRow[] => ALL_STATES.flatMap((state) => ["0", "1"].map((crop) => (
  { D1C: state, D1N: `UF ${state}`, D2C: "215", D2N: "Valor", D3N: String(year), D4C: crop, D4N: crop === "0" ? "Total" : "Soja", MN: "Mil Reais", V: value })));

const source = (value = "100") => async (url: string): Promise<unknown> => {
  if (url.includes("metadados")) return { periodicidade: { fim: 2025 } };
  const year = Number(/\/p\/(\d+)\//.exec(url)![1]);
  if (url.includes("/n1/")) {
    const total = String(Number(value) * 27);
    const row = (crop: string, name: string) => ({ D1C: "1", D1N: "Brasil", D2C: "215", D2N: "Valor", D3N: String(year), D4C: crop, D4N: name, MN: "Mil Reais", V: total });
    return [{}, row("0", "Total"), row("1", "Soja")];
  }
  return [{}, ...STATE_ROWS(year, value)];
};

test("carga em SQLite: troca tudo de uma vez, registra e alimenta a tela", async () => {
  const file = newFile();
  createDashboardFile(file);
  const store = await sqliteStore(file);
  assert.equal(await store.lock(), true);
  const logId = await store.start();
  await store.replace(logId, await prepareLoad(source()));
  await store.close();

  const reader = readerOf(file);
  const queries = createQueries(reader);
  const summary = await queries.summary({ year: 2025, region: null, state: null, crop: null }, ALL_STATES);
  assert.equal(summary.value, "2700000.00");
  const check = await queries.sourceCheck();
  assert.equal(check.length, 50);
  // A fonte simulada só tem o valor. Sem área para comparar, não há OK: é a regra da conferência.
  assert.deepEqual(new Set(check.filter((row) => row.kind !== "area").map((row) => row.status)), new Set(["OK"]));
  assert.deepEqual(new Set(check.filter((row) => row.kind === "area").map((row) => row.status)), new Set(["DIVERGE"]));
  const meta = await queries.meta();
  assert.match(meta.updatedAt!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(meta.warnings, []);
  await reader.end();
});

test("falha no meio da gravação mantém o dado anterior e fica registrada", async () => {
  const file = newFile();
  createDashboardFile(file);
  let store = await sqliteStore(file);
  await store.replace(await store.start(), await prepareLoad(source()));
  await store.close();

  store = await sqliteStore(file);
  const prepared = await prepareLoad(source("200"));
  // A última linha de produção é inválida: o que foi apagado e gravado antes dela precisa voltar.
  prepared.production[prepared.production.length - 1] = { ...prepared.production[0], value_brl: "abc" };
  const logId = await store.start();
  await assert.rejects(store.replace(logId, prepared), /inválido/);
  await store.fail(logId, "falha de teste");
  await store.close();

  const reader = readerOf(file);
  const queries = createQueries(reader);
  assert.equal((await queries.summary({ year: 2025, region: null, state: null, crop: null }, ALL_STATES)).value, "2700000.00");
  const meta = await queries.meta();
  assert.match(meta.warnings.join(), /última carga falhou/);
  assert.notEqual(meta.updatedAt, null);
  await reader.end();
});

test("duas cargas ao mesmo tempo: a segunda é recusada", async () => {
  const file = newFile();
  createDashboardFile(file);
  const first = await sqliteStore(file);
  const second = await sqliteStore(file);
  assert.equal(await first.lock(), true);
  assert.equal(await second.lock(), false);
  await second.close();
  await first.close();
  const third = await sqliteStore(file);
  assert.equal(await third.lock(), true);
  await third.close();
});

test("quem lê durante a carga vê o dado anterior, até o fim da transação", async () => {
  const file = filled();
  const reader = readerOf(file);
  const loader = new DatabaseSync(file);
  loader.exec("BEGIN IMMEDIATE; DELETE FROM production");
  assert.equal((await reader.query("SELECT COUNT(*) AS n FROM production")).rows[0].n, 2);
  loader.exec("COMMIT");
  assert.equal((await reader.query("SELECT COUNT(*) AS n FROM production")).rows[0].n, 0);
  loader.close();
  await reader.end();
});

const freePort = () => new Promise<number>((resolve) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});

test("servidor com o arquivo ausente sobe, e a API responde 503 em português", async () => {
  const port = await freePort();
  const server = spawn(process.execPath, ["server/main.ts"], { windowsHide: true,
    env: { ...process.env, DB_ENGINE: "sqlite", SQLITE_DIR: path.join(dir, "nunca-criado"), AUTH_MODE: "local", PORT: String(port), AGENT_PROVIDER: "" },
    stdio: "ignore",
  });
  try {
    let me: Response | null = null;
    for (let i = 0; i < 80 && !me; i++) {
      me = await fetch(`http://127.0.0.1:${port}/api/me`).catch(() => null);
      if (!me) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(me?.status, 200);
    const answer = await fetch(`http://127.0.0.1:${port}/api/d/producao-agricola/summary`);
    assert.equal(answer.status, 503);
    const body = await answer.json() as { error: string };
    assert.match(body.error, /ainda não foi criado/);
    assert.doesNotMatch(body.error, /nunca-criado/);
  } finally {
    server.kill();
  }
});
