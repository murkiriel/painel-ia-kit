// Comparação direta entre os motores: carrega os mesmos dados no Postgres e no SQLite, sobe um servidor de cada,
// e compara byte a byte as respostas da API em um conjunto amplo de recortes. Exige 0 diferenças.
// Só lê o exemplo do IBGE. O que cria são arquivos e um esquema temporários, apagados ao final.
//
//   npm run check:engines                      os dados anual e mensal derivado do exemplo
//   npm run check:engines -- --sabotar         muda 1 centavo no SQLite: precisa reprovar, com a diferença à vista
//   MONTH_CSV=arquivo.csv npm run check:engines  acrescenta o CSV mensal real, fora do repositório
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { dashboardEnv, readerAccess } from "../../../server/db/open.ts";
import { createSqliteFile, openSqlite, writeRows } from "../../../server/db/sqlite.ts";
import type { Db } from "../../../server/db/types.ts";
import { producaoAgricola } from "../dashboard.ts";
import { DB } from "../db.ts";
import { ALL_STATES, NO_FILTERS, type DetailDimension, type Filters } from "../domain/filters.ts";
import { createQueries } from "../domain/queries.ts";
import { loadCells, parseMonthlyCsv, prepareSchema, STATES, type Cell } from "../../../scripts/monthly-csv.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const SLUG = DB.slug;
const READER_URL = dashboardEnv(DB, "DATABASE_URL");
const API = `/api/d/${SLUG}`;

const SABOTAGE = process.argv.includes("--sabotar");
const CONCURRENCY = 6;
const PREFIX = "compare_engines_";
const MAX_SHOWN = 15;
const REGIONS = ["Norte", "Nordeste", "Sudeste", "Sul", "Centro-Oeste"];
const ROUTES = ["filter-options", "summary", "by-year", "by-region", "by-state", "by-crop", "detail"];

const tempDir = mkdtempSync(path.join(tmpdir(), PREFIX));
const admin = new pg.Client({ connectionString: `postgres://dev_admin:${process.env.DEV_ADMIN_PASSWORD}@127.0.0.1:${process.env.DEV_DB_PORT || 54329}/dashboard` });
await admin.connect();
const servers: ChildProcess[] = [];
const schemas: string[] = [];
const pools: Db[] = [];
let nextPort = 8791;
let compared = 0;
let differences = 0;

function report(label: string, a: string, b: string) {
  differences++;
  if (differences > MAX_SHOWN) return;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  const part = (text: string) => text.slice(Math.max(0, at - 50), at + 70);
  console.log(`DIFERENÇA | ${label}\n  Postgres: …${part(a)}…\n  SQLite:   …${part(b)}…`);
}

async function startServer(env: Record<string, string>) {
  const port = nextPort++;
  // Outro programa na porta responderia no lugar do servidor, e a comparação diria que os motores divergem.
  if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) throw new Error(`A porta ${port} está ocupada. Libere-a e rode de novo.`);
  const server = spawn(process.execPath, ["--env-file=.env", "server/main.ts"], { windowsHide: true,
    env: { ...process.env, MONTH_FILTER: "", AUTH_MODE: "local", AGENT_PROVIDER: "simulado", AGENT_LIMIT_PER_HOUR: "1000000", ...env, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  servers.push(server);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      await fetch(`${url}/api/me`);
      return url;
    } catch {
      if (i === 80) throw new Error(`O servidor na porta ${port} não subiu.`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

type Request = { path: string; body?: unknown };

const ask = async (base: string, { path: target, body }: Request) => {
  const response = await fetch(base + target, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  // O painel lista todos os dashboards do projeto, e um que só roda em Postgres diria outra coisa no SQLite. Aqui vale o cartão deste.
  const own = target === "/api/dashboards" && response.ok ? JSON.stringify({ dashboards: (JSON.parse(text).dashboards as { slug: string }[]).filter((card) => card.slug === SLUG) }) : text;
  return `${response.status} ${response.headers.get("content-type")} ${own}`;
};

/** Pergunta aos dois servidores e compara o texto inteiro da resposta: situação, tipo e corpo. */
async function compareAll(label: string, postgres: string, sqlite: string, requests: Request[]) {
  const started = Date.now();
  const before = { compared, differences };
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const request = requests[next++];
      const [a, b] = await Promise.all([ask(postgres, request), ask(sqlite, request)]);
      compared++;
      if (a !== b) report(`${label}: ${request.path}${request.body ? ` ${JSON.stringify(request.body)}` : ""}`, a, b);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`${label}: ${compared - before.compared} respostas comparadas, ${differences - before.differences} diferenças, ${((Date.now() - started) / 1000).toFixed(0)} s.`);
}

const q = (...parts: (string | null)[]) => parts.filter(Boolean).join("&");
const url = (route: string, query: string) => `${API}/${route}${query ? `?${query}` : ""}`;

/** Os recortes: cada um vira uma pergunta a cada rota. */
function annualRequests(years: string[], crops: string[]): Request[] {
  const list: Request[] = [];
  const allYears = [null, "ano=todos", ...years.map((year) => `ano=${year}`)];
  const places = [null, ...REGIONS.map((region) => `regiao=${encodeURIComponent(region)}`), ...ALL_STATES.map((state) => `uf=${state}`)];
  const last = years[0];
  const middle = years[Math.floor(years.length / 2)];
  // Todo ano com todo lugar.
  for (const year of allYears) for (const place of places) for (const route of ROUTES) list.push({ path: url(route, q(year, place)) });
  // Toda lavoura, em quatro períodos.
  for (const crop of crops) for (const year of [null, "ano=todos", `ano=${last}`, `ano=${middle}`]) for (const route of ROUTES) list.push({ path: url(route, q(year, `lavoura=${crop}`)) });
  // Lavoura com lugar, inclusive combinações que não trazem nada, e região com UF de outra região.
  const someCrops = [...crops.slice(0, 6), ...crops.slice(-4)];
  const somePlaces = [...REGIONS.map((region) => `regiao=${encodeURIComponent(region)}`), "uf=51", "uf=35", "uf=11", "uf=53", "uf=26"];
  for (const crop of someCrops) for (const place of somePlaces) for (const year of ["ano=todos", `ano=${last}`, `ano=${middle}`]) for (const route of ROUTES) list.push({ path: url(route, q(year, place, `lavoura=${crop}`)) });
  for (const route of ROUTES) for (const mix of ["regiao=Sul&uf=51", "regiao=Norte&uf=35", `ano=${last}&regiao=Sul&uf=51`]) list.push({ path: url(route, mix) });
  // Detalhe: toda dimensão, toda ordem, as duas direções, páginas e além do fim, em recortes variados.
  const cuts = [null, "ano=todos", `ano=${last}`, `ano=${middle}`, "regiao=Sul", "uf=51", `lavoura=${crops[0]}`, `ano=${last}&lavoura=${crops[0]}`, `ano=${last}&uf=51&lavoura=${crops[0]}`, "ano=todos&regiao=Nordeste"];
  const lineOrders = ["valor", "quantidade", "area", "ano", "uf", "regiao", "lavoura"];
  const groupOrders = ["valor", "quantidade", "area", "nome"];
  for (const cut of cuts) for (const page of ["pagina=1", "pagina=2", "pagina=3", "pagina=50", "pagina=999"]) for (const dir of ["asc", "desc"]) {
    for (const order of lineOrders) list.push({ path: url("detail", q(cut, page, `ordem=${order}`, `dir=${dir}`)) });
    for (const by of ["ano", "regiao", "uf", "lavoura"]) for (const order of groupOrders) list.push({ path: url("detail", q(cut, `por=${by}`, page, `ordem=${order}`, `dir=${dir}`)) });
  }
  // Conferência, situação e pedidos que precisam ser recusados, com a mesma mensagem.
  list.push({ path: `${API}/check` }, { path: `${API}/agent` }, { path: `${API}/info` }, { path: "/api/me" }, { path: "/api/dashboards" }, { path: "/api/nao-existe" }, { path: `${API}/nao-existe` }, { path: `${API}/by-month` });
  for (const bad of ["ano=1999", "ano=abc", "lavoura=99999", "lavoura=abc", "regiao=Marte", "uf=99", "uf=51&uf=35", "anoo=2024", "mes=3", "por=uf", "ano=2024&mes=3"]) {
    for (const route of ROUTES) list.push({ path: url(route, bad) });
  }
  for (const bad of ["por=constructor", "por=mes", "ordem=mes", "ordem=value_brl;DROP", "dir=lado", "pagina=0", "pagina=abc", "por=uf&ordem=uf", "ordem=nome"]) list.push({ path: url("detail", bad) });
  // O agente com o modelo simulado: a resposta inteira, com a origem.
  const screens = ["", `ano=${last}`, "ano=todos", "regiao=Norte", "uf=51", `lavoura=${crops[0]}`, `ano=${last}&uf=51`];
  const questions = ["Qual foi o valor da produção?", "Qual o valor por estado?", "Qual o valor por região?", "Quais são as maiores lavouras?", "Qual o valor por ano?", "Qual é a capital da França?", "Corrija o valor da produção para 100."];
  for (const query of screens) for (const question of questions) list.push({ path: `${API}/agent`, body: { question, query } });
  return list;
}

function monthRequests(years: string[], crops: string[]): Request[] {
  const list: Request[] = [];
  const routes = [...ROUTES, "by-month"];
  const months = [null, ...Array.from({ length: 12 }, (_, i) => `mes=${i + 1}`)];
  for (const year of [null, "ano=todos", ...years.map((y) => `ano=${y}`)]) for (const month of months) for (const route of routes) list.push({ path: url(route, q(year, month)) });
  const lastYears = years.slice(0, 3);
  const places = ["regiao=Sul", "regiao=Nordeste", "uf=51", "uf=35", "uf=11"];
  for (const year of lastYears) for (const place of places) for (const month of [null, "mes=1", "mes=3", "mes=9", "mes=12"]) for (const route of routes) list.push({ path: url(route, q(`ano=${year}`, place, month)) });
  for (const crop of crops) for (const year of ["ano=todos", ...lastYears.slice(0, 2).map((y) => `ano=${y}`)]) for (const route of ["summary", "by-year", "filter-options", "by-month"]) list.push({ path: url(route, q(year, `lavoura=${crop}`)) });
  const cuts = ["ano=todos", `ano=${years[0]}`, `ano=${years[0]}&mes=1`, `ano=${years[1]}&mes=3`, `ano=${years[1]}&uf=51`, `lavoura=${crops[0]}`];
  const lineOrders = ["valor", "quantidade", "area", "ano", "mes", "uf", "regiao", "lavoura"];
  const groupOrders = ["valor", "quantidade", "area", "nome"];
  for (const cut of cuts) for (const page of ["pagina=1", "pagina=2", "pagina=999"]) for (const dir of ["asc", "desc"]) {
    for (const order of lineOrders) list.push({ path: url("detail", q(cut, page, `ordem=${order}`, `dir=${dir}`)) });
    for (const by of ["ano", "mes", "regiao", "uf", "lavoura"]) for (const order of groupOrders) list.push({ path: url("detail", q(cut, `por=${by}`, page, `ordem=${order}`, `dir=${dir}`)) });
  }
  list.push({ path: `${API}/check` }, { path: `${API}/info` }, { path: "/api/me" });
  for (const bad of ["mes=3", "ano=todos&mes=3", `ano=${years[0]}&mes=13`, `ano=${years[0]}&mes=0`, `ano=${years[0]}&mes=03`, `ano=${years[0]}&mes=1&mes=2`]) for (const route of routes) list.push({ path: url(route, bad) });
  const screens = [`ano=${years[0]}`, `ano=${years[0]}&mes=2`, `ano=${years[1]}&mes=3&uf=51`];
  for (const query of screens) for (const question of ["Qual foi o valor da produção?", "Qual o valor por estado?", "Quais são as maiores lavouras?"]) list.push({ path: `${API}/agent`, body: { question, query } });
  return list;
}

/** As consultas direto, com permissão limitada: o modo com login usa estas mesmas chamadas. */
async function compareScopes(label: string, postgres: Db, sqlite: Db, hasMonth: boolean, year: number, crop: string) {
  const before = { compared, differences };
  const a = createQueries(postgres, { hasMonth });
  const b = createQueries(sqlite, { hasMonth });
  const scopes = [[], ["51"], ["51", "35"], ["11", "12", "13", "14", "15", "16", "17"], ALL_STATES.slice(0, 26), ALL_STATES];
  const cuts: Partial<Filters>[] = [{}, { year }, { year: year - 1 }, { region: "Sul" }, { state: "51" }, { crop }, { year, crop }, { year, state: "35" }, ...(hasMonth ? [{ year, month: 1 }, { year, month: 2, crop }] : [])];
  const calls: [string, (q: typeof a, f: Filters, scope: string[]) => Promise<unknown>][] = [
    ["summary", (x, f, s) => x.summary(f, s)], ["byYear", (x, f, s) => x.byYear(f, s)], ["byRegion", (x, f, s) => x.byRegion(f, s)], ["byState", (x, f, s) => x.byState(f, s)],
    ["byCrop", (x, f, s) => x.byCrop(f, s)], ["filterOptions", (x, f, s) => x.filterOptions(s, f)], ["latestYear", (x, _, s) => x.latestYear(s)],
    ...(hasMonth ? [["byMonth", (x: typeof a, f: Filters, s: string[]) => x.byMonth(f, s)] as [string, (q: typeof a, f: Filters, scope: string[]) => Promise<unknown>]] : []),
    ...(["ano", "regiao", "uf", "lavoura", null] as (DetailDimension | null)[]).map((by) => [`detail ${by}`, (x: typeof a, f: Filters, s: string[]) => x.detail(f, s, by, 1)] as [string, (q: typeof a, f: Filters, scope: string[]) => Promise<unknown>]),
  ];
  for (const scope of scopes) for (const cut of cuts) for (const [name, call] of calls) {
    const filters = { ...NO_FILTERS, ...(hasMonth ? { month: null } : {}), ...cut };
    const [x, y] = [JSON.stringify(await call(a, filters, scope)), JSON.stringify(await call(b, filters, scope))];
    compared++;
    if (x !== y) report(`${label}: ${name}, ${JSON.stringify(cut)}, ${scope.length} UFs`, x, y);
  }
  console.log(`${label}: ${compared - before.compared} consultas com permissão limitada, ${differences - before.differences} diferenças.`);
}

/** Tempo de uma pergunta de cada vez, sem concorrência: a mediana de 5 repetições. */
async function timing(label: string, postgres: string, sqlite: string, paths: string[]) {
  const median = async (base: string, target: string) => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await (await fetch(base + target)).text();
      times.push(performance.now() - started);
    }
    return times.sort((a, b) => a - b)[2];
  };
  console.log(`\nTempos, ${label} (mediana de 5, em ms, por resposta, com todas as consultas da rota):`);
  for (const target of paths) console.log(`  ${(await median(postgres, target)).toFixed(0).padStart(5)} Postgres | ${(await median(sqlite, target)).toFixed(0).padStart(5)} SQLite | ${target}`);
}

/** Abre um esquema temporário no Postgres de desenvolvimento, com o mês, sem mexer no exemplo. */
async function monthSchema(rows: { production: Row[]; national: Row[] } | null, cells: Cell[] | null) {
  const schema = PREFIX + randomBytes(6).toString("hex");
  schemas.push(schema);
  await admin.query(`CREATE SCHEMA ${schema}`);
  await prepareSchema(admin, schema, {
    tables: readFileSync("dashboards/producao-agricola/sql/001_schema.sql", "utf8"),
    month: readFileSync("dashboards/producao-agricola/sql/optional_month.sql", "utf8"),
    grants: readFileSync("dashboards/producao-agricola/sql/002_grants.sql", "utf8"),
  });
  // A mesma escala que o SQLite usa neste teste. Sem limite, o Postgres guardaria as casas de cada linha: veja o README.
  await admin.query("ALTER TABLE production ALTER COLUMN value_brl TYPE NUMERIC(20, 4)");
  await admin.query("ALTER TABLE source_national ALTER COLUMN value_brl TYPE NUMERIC(20, 4)");
  if (cells) await loadCells(admin, cells);
  if (rows) {
    await insertPostgres("production", rows.production);
    await insertPostgres("source_national", rows.national);
  }
  await admin.query("INSERT INTO load_log (entity, started_at, finished_at, status) VALUES ('comparação', '2026-10-30T10:00:00Z', '2026-10-30T10:01:00.123Z', 'ok')");
  await admin.query("ANALYZE production");
  await admin.query("SET search_path TO public");
  const databaseUrl = new URL(process.env[READER_URL]!);
  databaseUrl.searchParams.set("options", `-c search_path=${schema}`);
  return databaseUrl.toString();
}

type Row = Record<string, unknown>;

async function insertPostgres(table: string, rows: Row[]) {
  const BATCH = 2000;
  for (let start = 0; start < rows.length; start += BATCH) {
    const part = rows.slice(start, start + BATCH);
    const columns = Object.keys(part[0]);
    const values: unknown[] = [];
    const lines = part.map((row) => `(${columns.map((column) => `$${values.push(row[column])}`).join(", ")})`);
    await admin.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${lines.join(", ")}`, values);
  }
}

function sqliteFile(name: string, options: { month?: boolean; valueScale?: number }, tables: Record<string, Row[]>) {
  const dir = path.join(tempDir, name.replace(".sqlite", ""));
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${SLUG}.sqlite`);
  createSqliteFile(file, producaoAgricola.sqlite({ MONTH_FILTER: options.month ? "on" : "", SQLITE_VALUE_SCALE: options.valueScale ? String(options.valueScale) : "" }));
  const connection = openSqlite(file, null);
  const db = connection.handle();
  db.exec("BEGIN");
  for (const [table, rows] of Object.entries(tables)) writeRows(db, table, rows);
  db.exec("COMMIT; ANALYZE");
  return { file, dir, connection };
}

/**
 * O exemplo é anual. Para provar o mês com muitos dados, cada linha vira uma ou duas, em meses vindos de uma conta fixa,
 * com 4 casas no valor, lacunas de meses e o último ano só até setembro. Não é dado real: só serve para comparar os motores.
 */
function deriveMonths(rows: Row[], lastYear: number): Row[] {
  const months: Row[] = [];
  const split = (text: string, scale: number, share: bigint, cents: bigint): [string, string] => {
    const power = 10n ** BigInt(scale);
    const total = BigInt(text.replace(".", "")) * power / 10n ** BigInt(text.split(".")[1]?.length ?? 0);
    const first = (total * share) / 10n + cents;
    const show = (value: bigint) => `${value / power}.${(value % power).toString().padStart(scale, "0")}`;
    return [show(first), show(total - first)];
  };
  for (const row of rows) {
    const hash = Number(row.year) * 31 + Number(row.state_code) * 7 + Number(row.crop_code) * 13;
    const span = Number(row.year) === lastYear ? 9 : 12;
    const first = (hash % span) + 1;
    const second = ((hash + 5) % span) + 1;
    const single = hash % 5 === 0;
    const parts = (text: unknown, scale: number) => (text === null ? [null, null] : single ? [split(String(text), scale, 10n, 0n)[0], null] : split(String(text), scale, BigInt(hash % 9) + 1n, BigInt(hash % 97)));
    const value = parts(row.value_brl, 4);
    const quantity = parts(row.quantity_t, 3);
    const area = parts(row.area_ha, 3);
    months.push({ ...row, month: first, value_brl: value[0], quantity_t: quantity[0], area_ha: area[0] });
    if (!single) months.push({ ...row, month: second, value_brl: value[1], quantity_t: quantity[1], area_ha: area[1] });
  }
  return months;
}

try {
  // Sobra de uma execução interrompida não fica no banco.
  for (const { nspname } of (await admin.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE $1", [`${PREFIX}%`])).rows) await admin.query(`DROP SCHEMA ${nspname} CASCADE`);

  // 1. Os dados do exemplo, como estão no Postgres, em texto, sem passar por número.
  const production: Row[] = (await admin.query(`
    SELECT year, state_code, state_name, region, crop_code, crop_name, value_brl::text AS value_brl, quantity_t::text AS quantity_t, quantity_unit, area_ha::text AS area_ha
    FROM ${DB.schema}.production ORDER BY year, state_code, crop_code`)).rows;
  const national: Row[] = (await admin.query(`SELECT year, crop_code, value_brl::text AS value_brl, quantity_t::text AS quantity_t, area_ha::text AS area_ha FROM ${DB.schema}.source_national ORDER BY year, crop_code`)).rows;
  const raw: Row[] = (await admin.query(`SELECT * FROM ${DB.schema}.raw_production ORDER BY year, state_code, variable, crop_code`)).rows;
  const log: Row[] = (await admin.query(`SELECT id::int AS id, entity, started_at, finished_at, status, rows_read, rows_saved, rows_rejected, error FROM ${DB.schema}.load_log ORDER BY id`)).rows
    .map((row) => ({ ...row, started_at: row.started_at.toISOString(), finished_at: row.finished_at?.toISOString() ?? null }));
  console.log(`Dados do exemplo: ${production.length} linhas de produção, ${national.length} totais da fonte, ${raw.length} linhas brutas, ${log.length} cargas.`);
  if (production.length === 0) throw new Error("O Postgres está sem dados: rode npm run load.");

  const annual = sqliteFile("anual.sqlite", {}, { production, source_national: national, raw_production: raw, load_log: log });
  if (SABOTAGE) {
    annual.connection.handle().exec("UPDATE production SET value_brl = value_brl + 1 WHERE rowid = 1");
    console.log("Sabotagem: 1 centavo a mais em uma linha do SQLite. A comparação precisa reprovar.");
  }
  await annual.connection.end();

  const years = [...new Set(production.map((row) => String(row.year)))].sort().reverse();
  const crops = [...new Set(production.map((row) => String(row.crop_code)))].sort();

  const postgresUrl = await startServer({ DB_ENGINE: "postgres" });
  const sqliteUrl = await startServer({ DB_ENGINE: "sqlite", SQLITE_DIR: annual.dir });
  await compareAll("Anual", postgresUrl, sqliteUrl, annualRequests(years, crops));

  // 2. Permissão limitada, nas mesmas consultas do modo com login.
  const directPostgres = new pg.Pool({ connectionString: process.env[READER_URL], options: `-c search_path=${DB.schema}`, max: 2 }) as unknown as Db;
  const directSqlite = openSqlite(annual.file, readerAccess(DB));
  pools.push(directPostgres, directSqlite);
  await compareScopes("Anual", directPostgres, directSqlite, false, Number(years[0]), crops[0]);

  await timing("anual", postgresUrl, sqliteUrl, [
    `${API}/summary?ano=todos`, `${API}/summary?ano=${years[0]}`, `${API}/by-year?ano=todos`, `${API}/by-crop?ano=todos`, `${API}/by-state?ano=todos`, `${API}/filter-options?ano=todos`,
    `${API}/detail?ano=todos`, `${API}/detail?ano=todos&ordem=lavoura&dir=asc`, `${API}/detail?ano=todos&por=lavoura&ordem=nome`, `${API}/check`,
  ]);

  // 3. O mês ligado, com dado derivado, 4 casas no valor e lacunas.
  const monthRows = deriveMonths(production, Number(years[0]));
  const monthLog = [{ entity: "comparação", started_at: "2026-10-30T10:00:00.000Z", finished_at: "2026-10-30T10:01:00.123Z", status: "ok" }];
  const monthNational = national.map((row) => ({ ...row }));
  const monthUrl = await monthSchema({ production: monthRows, national: monthNational }, null);
  const month = sqliteFile("mes.sqlite", { month: true, valueScale: 4 }, { production: monthRows, source_national: monthNational, load_log: monthLog });
  await month.connection.end();
  console.log(`\nMês ligado: ${monthRows.length} linhas derivadas.`);
  const postgresMonth = await startServer({ DB_ENGINE: "postgres", [READER_URL]: monthUrl, MONTH_FILTER: "on" });
  const sqliteMonth = await startServer({ DB_ENGINE: "sqlite", SQLITE_DIR: month.dir, MONTH_FILTER: "on" });
  await compareAll("Mês", postgresMonth, sqliteMonth, monthRequests(years, crops));
  const monthPostgres = new pg.Pool({ connectionString: monthUrl, max: 2 }) as unknown as Db;
  const monthSqlite = openSqlite(month.file, readerAccess(DB));
  pools.push(monthPostgres, monthSqlite);
  await compareScopes("Mês", monthPostgres, monthSqlite, true, Number(years[0]), crops[0]);

  // 4. Opcional: o CSV mensal real, se houver uma cópia local.
  const csv = process.env.MONTH_CSV;
  if (csv) {
    const cells = parseMonthlyCsv(readFileSync(csv));
    const stateOf = new Map(Object.values(STATES).map((state) => [state.code, state]));
    const csvRows: Row[] = cells.map((c) => ({
      year: c.year, month: c.month, state_code: c.state, state_name: stateOf.get(c.state)!.name, region: stateOf.get(c.state)!.region,
      crop_code: c.cropCode, crop_name: c.cropName, value_brl: c.value, quantity_unit: "t",
    }));
    const csvUrl = await monthSchema(null, cells);
    const csvFile = sqliteFile("csv.sqlite", { month: true, valueScale: 4 }, { production: csvRows, load_log: monthLog });
    await csvFile.connection.end();
    console.log(`\nCSV mensal: ${cells.length} linhas.`);
    const postgresCsv = await startServer({ DB_ENGINE: "postgres", [READER_URL]: csvUrl, MONTH_FILTER: "on" });
    const sqliteCsv = await startServer({ DB_ENGINE: "sqlite", SQLITE_DIR: csvFile.dir, MONTH_FILTER: "on" });
    const csvYears = [...new Set(cells.map((c) => String(c.year)))].sort().reverse();
    const csvCrops = [...new Set(cells.map((c) => c.cropCode))].sort();
    await compareAll("CSV", postgresCsv, sqliteCsv, monthRequests(csvYears, csvCrops));
    await timing("CSV mensal", postgresCsv, sqliteCsv, [`${API}/summary?ano=todos`, `${API}/summary?ano=${csvYears[0]}`, `${API}/summary?ano=${csvYears[0]}&mes=1`, `${API}/by-crop?ano=todos`, `${API}/filter-options?ano=todos`, `${API}/detail?ano=todos`, `${API}/detail?ano=todos&ordem=lavoura&dir=asc`]);
  }

  console.log(`\n${compared} respostas comparadas byte a byte, ${differences} diferenças.`);
} finally {
  for (const server of servers) server.kill();
  for (const pool of pools) await pool.end();
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  const left = await admin.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE $1", [`${PREFIX}%`]);
  await admin.end();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  console.log(left.rows[0].n === 0 ? "Esquemas e arquivos temporários apagados." : "ATENÇÃO: sobrou esquema temporário.");
}
process.exitCode = differences === 0 ? 0 : 1;
