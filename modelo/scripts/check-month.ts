// Ferramenta de prova do kit, fora de qualquer dashboard: usa a estrutura do exemplo do IBGE com um CSV mensal de outra fonte,
// só em um esquema (ou arquivo) temporário, e não toca nos dados de nenhum dashboard.
// Prova o mês ligado com dado real: carrega o CSV mensal em um esquema temporário do banco de desenvolvimento,
// sobe o servidor em outra porta com MONTH_FILTER=on e compara os totais da API com a soma feita direto no CSV.
// Exige 0 divergências e apaga o que criou. O exemplo do IBGE não é tocado.
// Com DB_ENGINE=sqlite, o esquema temporário é um arquivo temporário, e o Postgres não é usado.
//
//   npm run check:month -- caminho/do/arrecadacao-estado.csv     (ou a variável MONTH_CSV)
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { producaoAgricola } from "../dashboards/producao-agricola/dashboard.ts";
import { dashboardEnv, readEngine } from "../server/db/open.ts";
import { fromScaled, loadCells, loadCellsSqlite, parseMonthlyCsv, prepareSchema, STATES, toScaled, totalsBy, type Cell } from "./monthly-csv.ts";

const CSV_PATH = process.argv[2] ?? process.env.MONTH_CSV;
if (!CSV_PATH) {
  console.error("Informe o caminho do CSV: npm run check:month -- caminho.csv, ou a variável MONTH_CSV.");
  process.exit(1);
}

if (existsSync(".env")) process.loadEnvFile(".env");
const PORT = "8790";
const API = `http://127.0.0.1:${PORT}`;
const PREFIX = "check_month_";
const schema = PREFIX + randomBytes(6).toString("hex");

let divergences = 0;
let compared = 0;

function same(label: string, expected: string | null, actual: string | null | undefined) {
  compared++;
  const equal = expected === null || actual === null || actual === undefined ? expected === (actual ?? null) : toScaled(expected) === toScaled(actual);
  if (equal) return;
  divergences++;
  console.log(`DIVERGE | ${label} | CSV ${expected} | API ${actual}`);
}

function truth(label: string, ok: boolean, extra = "") {
  compared++;
  if (ok) return;
  divergences++;
  console.log(`DIVERGE | ${label} ${extra}`);
}

const getJson = async (path: string) => {
  const response = await fetch(API + path);
  if (!response.ok) throw new Error(`${path} respondeu ${response.status}`);
  return response.json();
};
const statusOf = async (path: string) => (await fetch(API + path)).status;

const pad = (month: number) => String(month).padStart(2, "0");

// 1. O que o CSV diz, sem passar pelo banco nem pelo código do modelo.
const cells = parseMonthlyCsv(readFileSync(CSV_PATH));
const byMonth = totalsBy(cells, (c) => `${c.year}-${c.month}`);
const byYear = totalsBy(cells, (c) => String(c.year));
const monthsOf = (list: Cell[]) => {
  const months = new Map<number, Set<number>>();
  for (const c of list) months.set(c.year, (months.get(c.year) ?? new Set()).add(c.month));
  return months;
};
const months = monthsOf(cells);
const years = [...months.keys()].sort((a, b) => a - b);
const lastYear = years.at(-1)!;
const lastMonth = Math.max(...months.get(lastYear)!);
const missingMonth = lastMonth < 12 ? lastMonth + 1 : null;
console.log(`CSV: ${cells.length} células, ${byMonth.size} meses, de ${years[0]} a ${pad(lastMonth)}/${lastYear}.`);

const sqlite = readEngine(process.env.DB_ENGINE) === "sqlite";
const admin = sqlite ? null : new pg.Client({ connectionString: `postgres://dev_admin:${process.env.DEV_ADMIN_PASSWORD}@127.0.0.1:${process.env.DEV_DB_PORT || 54329}/dashboard` });
await admin?.connect();
let server: ReturnType<typeof spawn> | null = null;
const tempDir = sqlite ? mkdtempSync(path.join(tmpdir(), PREFIX)) : "";

try {
  const engineEnv: Record<string, string> = {};
  if (admin) {
    // Sobra de uma execução interrompida não fica no banco.
    const old = await admin.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE $1", [`${PREFIX}%`]);
    for (const { nspname } of old.rows) await admin.query(`DROP SCHEMA ${nspname} CASCADE`);

    await admin.query(`CREATE SCHEMA ${schema}`);
    await prepareSchema(admin, schema, {
      tables: readFileSync("dashboards/producao-agricola/sql/001_schema.sql", "utf8"),
      month: readFileSync("dashboards/producao-agricola/sql/optional_month.sql", "utf8"),
      grants: readFileSync("dashboards/producao-agricola/sql/002_grants.sql", "utf8"),
    });
    await loadCells(admin, cells);
    await admin.query("INSERT INTO load_log (entity, started_at, finished_at, status) VALUES ('prova do mês', now(), now(), 'ok')");
    await admin.query("ANALYZE production");

    // O servidor do modelo, com o usuário só de leitura, vendo apenas o esquema temporário.
    const databaseUrl = new URL(process.env[dashboardEnv(producaoAgricola.db, "DATABASE_URL")]!);
    databaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    engineEnv[dashboardEnv(producaoAgricola.db, "DATABASE_URL")] = databaseUrl.toString();
  } else {
    // No SQLite, escala 4 no valor: o arquivo tem até 4 casas.
    engineEnv.SQLITE_DIR = tempDir;
    await loadCellsSqlite(path.join(tempDir, "producao-agricola.sqlite"), cells);
  }
  server = spawn(process.execPath, ["--env-file=.env", "server/main.ts"], { windowsHide: true,
    env: { ...process.env, ...engineEnv, MONTH_FILTER: "on", AUTH_MODE: "local", PORT, AGENT_PROVIDER: "" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; ; i++) {
    try {
      await fetch(`${API}/api/me`);
      break;
    } catch {
      if (i === 40) throw new Error("O servidor não subiu.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  // 2. Ano a ano: todos os anos, e o incompleto marcado.
  const yearly = await getJson("/api/d/producao-agricola/by-year?ano=todos");
  truth("lista de anos", yearly.categories.join() === years.join());
  years.forEach((year, i) => same(`ano ${year}`, fromScaled(byYear.get(String(year))!), yearly.totals[i]));
  const expectedPartial = years.filter((year) => months.get(year)!.size < 12).map(String);
  truth("anos incompletos", Object.keys(yearly.partial).join() === expectedPartial.join(), JSON.stringify(yearly.partial));
  truth("ano mais recente até o último mês", yearly.partial[lastYear]?.last === lastMonth);

  for (const year of years) {
    // 3. Mês a mês, no gráfico de meses, no seletor, nos cartões e no detalhe.
    const list = [...months.get(year)!].sort((a, b) => a - b);
    const chart = await getJson(`/api/d/producao-agricola/by-month?ano=${year}`);
    truth(`meses do gráfico em ${year}`, chart.rows.map((r: { key: string }) => r.key).join() === list.join());
    for (const row of chart.rows) same(`gráfico ${year}-${row.key}`, fromScaled(byMonth.get(`${year}-${row.key}`)!), row.value);
    const options = await getJson(`/api/d/producao-agricola/filter-options?ano=${year}`);
    truth(`meses do seletor em ${year}`, options.mes.map((o: { key: string }) => o.key).join() === list.join());

    for (const month of list) {
      const current = byMonth.get(`${year}-${month}`)!;
      const previous = byMonth.get(`${year - 1}-${month}`) ?? null;
      const summary = await getJson(`/api/d/producao-agricola/summary?ano=${year}&mes=${month}`);
      same(`resumo ${year}-${month}`, fromScaled(current), summary.value);
      same(`mês do ano anterior ${year}-${month}`, previous === null ? null : fromScaled(previous), summary.previousValue);
      truth(`variação existe ${year}-${month}`, (summary.valueVariation !== null) === (previous !== null && previous !== 0n));
      truth(`período ${year}-${month}`, summary.firstPeriod === `${year}-${pad(month)}` && summary.lastPeriod === summary.firstPeriod);
      const detail = await getJson(`/api/d/producao-agricola/detail?ano=${year}&mes=${month}`);
      same(`detalhe ${year}-${month}`, fromScaled(current), detail.totals.value);
      truth(`linhas ${year}-${month}`, detail.totals.lines === cells.filter((c) => c.year === year && c.month === month).length);
      truth(`coluna de mês ${year}-${month}`, detail.rows.every((r: { month: number; year: number }) => r.month === month && r.year === year));
    }

    // 4. O ano: a comparação só com os mesmos meses.
    const summary = await getJson(`/api/d/producao-agricola/summary?ano=${year}`);
    same(`resumo ${year}`, fromScaled(byYear.get(String(year))!), summary.value);
    const previousList = list.filter((month) => byMonth.has(`${year - 1}-${month}`));
    const previousTotal = previousList.reduce((sum, month) => sum + byMonth.get(`${year - 1}-${month}`)!, 0n);
    same(`ano anterior, mesmos meses, ${year}`, previousList.length ? fromScaled(previousTotal) : null, summary.previousValue);
    truth(`variação do ano ${year}`, (summary.valueVariation !== null) === (previousList.length === list.length && previousTotal !== 0n));

    const perMonth = await getJson(`/api/d/producao-agricola/detail?ano=${year}&por=mes&ordem=nome&dir=asc`);
    truth(`detalhe por mês ${year}`, perMonth.rows.map((r: { key: string }) => r.key).join() === list.map((month) => `${year}-${pad(month)}`).join());
    for (const row of perMonth.rows) same(`detalhe por mês ${row.key}`, fromScaled(byMonth.get(`${year}-${Number(row.key.slice(5))}`)!), row.value);
  }

  // 5. Item com lacuna: onde o ano anterior tem outros meses, a variação não existe.
  const byItem = new Map<string, Cell[]>();
  for (const c of cells) byItem.set(c.cropCode, [...(byItem.get(c.cropCode) ?? []), c]);
  let gaps = 0;
  for (const [code, list] of byItem) {
    const itemMonths = monthsOf(list);
    const totals = totalsBy(list, (c) => `${c.year}-${c.month}`);
    for (const [year, current] of itemMonths) {
      const before = itemMonths.get(year - 1);
      if (!before) continue;
      const shared = [...current].filter((month) => before.has(month));
      if (shared.length === current.size) continue;
      gaps++;
      const summary = await getJson(`/api/d/producao-agricola/summary?ano=${year}&lavoura=${code}`);
      truth(`sem variação com outros meses: item ${code} em ${year}`, summary.valueVariation === null);
      const previous = shared.reduce((sum, month) => sum + totals.get(`${year - 1}-${month}`)!, 0n);
      same(`anterior do item ${code} em ${year}`, shared.length ? fromScaled(previous) : null, summary.previousValue);
    }
  }
  console.log(`Itens com meses diferentes do ano anterior: ${gaps} casos.`);

  // 6. O recorte manda no seletor de meses e na marca do ano incompleto, item a item.
  for (const [code, list] of byItem) {
    const itemMonths = monthsOf(list);
    const partial = (await getJson(`/api/d/producao-agricola/by-year?ano=todos&lavoura=${code}`)).partial;
    const expected = [...itemMonths].filter(([, set]) => set.size < 12).map(([year]) => String(year)).sort();
    truth(`anos incompletos do item ${code}`, Object.keys(partial).sort().join() === expected.join(), JSON.stringify(partial));
    for (const year of itemMonths.keys()) {
      const set = [...itemMonths.get(year)!].sort((a, b) => a - b);
      if (partial[year]) truth(`meses do item ${code} em ${year}`, partial[year].months === set.length && partial[year].first === set[0] && partial[year].last === set.at(-1));
      if (set.length === 12 && year !== lastYear) continue;
      const options = await getJson(`/api/d/producao-agricola/filter-options?ano=${year}&lavoura=${code}`);
      truth(`seletor do item ${code} em ${year}`, options.mes.map((o: { key: string }) => o.key).join() === set.join());
    }
  }

  // 7. O gráfico de meses não encolhe com um mês escolhido.
  const whole = await getJson(`/api/d/producao-agricola/by-month?ano=${lastYear}`);
  for (const month of [1, lastMonth]) {
    const withMonth = await getJson(`/api/d/producao-agricola/by-month?ano=${lastYear}&mes=${month}`);
    truth(`gráfico de meses inteiro com o mês ${month}`, JSON.stringify(whole.rows) === JSON.stringify(withMonth.rows));
  }

  // 8. Recortes do mês mais recente: UF por UF, região e item.
  const last = cells.filter((c) => c.year === lastYear && c.month === lastMonth);
  const latest = `ano=${lastYear}&mes=${lastMonth}`;
  const stateTotals = totalsBy(last, (c) => c.state);
  const states = await getJson(`/api/d/producao-agricola/by-state?${latest}`);
  truth("UFs no mês mais recente", states.rows.length === Object.keys(STATES).length);
  for (const row of states.rows) same(`UF ${row.key}`, fromScaled(stateTotals.get(row.key)!), row.value);
  const regionOf = new Map(Object.values(STATES).map((s) => [s.code, s.region]));
  const regionTotals = totalsBy(last, (c) => regionOf.get(c.state)!);
  for (const row of (await getJson(`/api/d/producao-agricola/by-region?${latest}`)).rows) same(`região ${row.key}`, fromScaled(regionTotals.get(row.key)!), row.value);
  const itemTotals = totalsBy(last, (c) => c.cropCode);
  for (const code of itemTotals.keys()) same(`item ${code}`, fromScaled(itemTotals.get(code)!), (await getJson(`/api/d/producao-agricola/summary?${latest}&lavoura=${code}`)).value);
  const stateAndMonth = await getJson(`/api/d/producao-agricola/summary?${latest}&uf=35`);
  same("São Paulo no mês", fromScaled(stateTotals.get("35")!), stateAndMonth.value);

  // 9. O que precisa ser recusado.
  const refused = ["/api/d/producao-agricola/summary?mes=3", "/api/d/producao-agricola/summary?ano=todos&mes=3", `/api/d/producao-agricola/summary?ano=${lastYear}&mes=13`, `/api/d/producao-agricola/summary?ano=${lastYear}&mes=0`, `/api/d/producao-agricola/summary?ano=${lastYear}&mes=03`, `/api/d/producao-agricola/summary?ano=${lastYear}&mes=1&mes=2`, `/api/d/producao-agricola/by-month?mes=3`, "/api/d/producao-agricola/detail?mes=3", "/api/d/producao-agricola/filter-options?ano=todos&mes=1"];
  if (missingMonth) refused.push(`/api/d/producao-agricola/summary?ano=${lastYear}&mes=${missingMonth}`);
  for (const path of refused) truth(`recusado: ${path}`, (await statusOf(path)) === 400);
  for (const path of ["/api/d/producao-agricola/summary?mes=3", "/api/d/producao-agricola/summary?ano=todos&mes=3"]) {
    truth(`mês sem ano: ${path}`, /Escolha um ano/.test((await (await fetch(API + path)).json()).error));
  }

  console.log(`\n${compared} comparações, ${divergences} divergências.`);
} finally {
  server?.kill();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    const left = await admin.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1", [schema]);
    console.log(left.rows[0].n === 0 ? "Esquema temporário apagado." : "ATENÇÃO: o esquema temporário não foi apagado.");
    await admin.end();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 500));
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    console.log("Arquivo temporário apagado.");
  }
}
process.exitCode = divergences === 0 ? 0 : 1;
