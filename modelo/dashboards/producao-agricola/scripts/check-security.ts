// Prova as travas de consulta e de rota deste dashboard. Rode com o banco e o servidor no ar, em modo local (sem login):
// DASHBOARD_URL aponta para ele. As travas de banco do portal ficam em scripts/check-security.ts.
// Nenhuma tentativa de escrita altera dados: todas precisam falhar.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { openReader, readEngine, sqliteFile } from "../../../server/db/open.ts";
import { DB } from "../db.ts";
import { createQueries } from "../domain/queries.ts";
import { ALL_STATES, NO_FILTERS } from "../domain/filters.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const SERVER = process.env.DASHBOARD_URL ?? "http://127.0.0.1:8787";
const API_URL = `${SERVER}/api/d/producao-agricola`;

const sqlite = readEngine(process.env.DB_ENGINE) === "sqlite";
const reader = await openReader(DB);

// Postgres: usuários sem permissão. SQLite: sem usuários, conexão somente para leitura e permissões por conexão.
const REFUSED = sqlite ? /readonly|not authorized|authorization denied|prohibited|too many attached/ : /permission denied|must be owner/;
const NO_ACCESS = sqlite ? /not authorized|prohibited/ : /permission denied/;

// Não se aplica ao SQLite: TRUNCATE não existe nele. O DELETE, que está na lista, é o equivalente.
const ATTEMPTS = [
  "INSERT INTO production (year, state_code, state_name, region, crop_code, crop_name) VALUES (1, 'x', 'x', 'x', 'x', 'x')",
  "UPDATE production SET value_brl = 0",
  "DELETE FROM production",
  ...(sqlite ? [] : ["TRUNCATE production"]),
  "DROP TABLE production",
  "CREATE TABLE teste (id int)",
  // Só no SQLite. No Postgres, quem impede isso é o usuário, já provado nas tentativas acima.
  ...(sqlite ? [
    "CREATE TEMP TABLE teste (id int)", "CREATE INDEX teste ON production (year)", "ALTER TABLE production ADD COLUMN teste INTEGER",
    "ATTACH DATABASE 'teste.sqlite' AS teste", "VACUUM", "PRAGMA query_only = OFF", "PRAGMA writable_schema = ON", "UPDATE load_log SET status = 'error'",
  ] : []),
];

// No SQLite, a prova inclui os bytes do arquivo: o hash não muda depois de todas as tentativas.
const fileHash = () => [sqliteFile(DB.slug), `${sqliteFile(DB.slug)}-wal`].filter(existsSync).map((file) => createHash("sha256").update(readFileSync(file)).digest("hex")).join();
const hashBefore = sqlite ? fileHash() : "";
if (sqlite) console.log("Não se aplica ao SQLite: TRUNCATE, porque o comando não existe nele. O DELETE é o equivalente e está provado abaixo.");
if (sqlite) console.log("Não se aplica ao SQLite: usuários de banco, porque ele não os tem. A separação é por conexão, e quem abre o arquivo com outro programa passa por cima: proteja a pasta.");

for (const sql of ATTEMPTS) {
  await assert.rejects(reader.query(sql), REFUSED, `consulta conseguiu: ${sql}`);
  console.log(`OK, ${sqlite ? "conexão de consulta recusada" : "usuário de consulta recusado"}: ${sql.split(" ").slice(0, 2).join(" ")}`);
}
if (sqlite) {
  assert.equal(fileHash(), hashBefore);
  console.log("OK, o arquivo do banco não mudou: o hash é o mesmo depois de todas as tentativas.");
}

const queries = createQueries(reader);
const empty = await queries.summary(NO_FILTERS, []);
assert.equal(empty.value, null);
assert.equal((await queries.byState(NO_FILTERS, [])).rows.length, 0);
assert.equal((await queries.detail(NO_FILTERS, [], null, 1)).rows.length, 0);
console.log("OK, permissão vazia não traz linhas.");

const oneState = await queries.byState(NO_FILTERS, ["51"]);
assert.deepEqual(oneState.rows.map((r) => r.key), ["51"]);
assert.equal((await queries.byState({ ...NO_FILTERS, state: "35" }, ["51"])).rows.length, 0);
console.log("OK, filtro não sai da permissão.");

const status = async (path: string) => (await fetch(API_URL + path)).status;
assert.equal(await status("/summary?anoo=2024"), 400);
assert.equal(await status("/summary?por=uf"), 400);
assert.equal(await status("/by-state?uf=51%27%20OR%201=1"), 400);
assert.equal(await status("/detail?ordem=value_brl;DROP"), 400);
assert.equal(await status("/summary?ano=1999"), 400);
assert.equal(await status("/summary?lavoura=99999"), 400);
assert.equal(await status("/nao-existe"), 404);
assert.equal((await fetch(`${SERVER}/api/nao-existe`)).status, 404);
// Com o mês desligado, ele não existe. Com ele ligado, a prova é o npm run check:month.
const { hasMonth } = await (await fetch(`${API_URL}/info`)).json() as { hasMonth?: boolean };
if (!hasMonth) {
  assert.equal(await status("/summary?ano=2024&mes=3"), 400);
  assert.equal(await status("/detail?por=mes"), 400);
  assert.equal(await status("/detail?ordem=mes"), 400);
  assert.equal(await status("/by-month"), 404);
}
console.log("OK, rotas recusam parâmetro desconhecido e não interpretam SQL.");

// A soma das linhas do detalhe bate com o valor do gráfico.
const byCrop = await queries.byCrop({ ...NO_FILTERS, year: 2024 }, ["51"]);
const top = byCrop.rows[0];
const lines = await queries.detail({ ...NO_FILTERS, year: 2024, crop: top.key }, ["51"], null, 1);
assert.equal(Number(lines.totals.value), Number(top.value));
const check = await queries.byRegion({ ...NO_FILTERS, year: 2024 }, ["51"]);
assert.equal(Number(check.total), Number((await queries.summary({ ...NO_FILTERS, year: 2024 }, ["51"])).value));
console.log("OK, detalhe e blocos batem entre si.");

// Sem lavoura, não existe total em toneladas, em nenhum bloco.
assert.equal((await queries.summary({ ...NO_FILTERS, year: 2024 }, ALL_STATES)).quantity, null);
assert.equal((await queries.detail({ ...NO_FILTERS, year: 2024 }, ALL_STATES, null, 1)).totals.quantity, null);
assert.equal((await queries.detail({ ...NO_FILTERS, year: 2024 }, ALL_STATES, "uf", 1)).rows[0].quantity, null);
assert.notEqual((await queries.summary({ ...NO_FILTERS, year: 2024, crop: top.key }, ALL_STATES)).quantity, null);
console.log("OK, o total em toneladas só aparece com uma lavoura.");

// Sem ano, a área não é somada; com ano, é.
assert.equal((await queries.summary(NO_FILTERS, ALL_STATES)).area, null);
assert.equal((await queries.detail(NO_FILTERS, ALL_STATES, null, 1)).totals.area, null);
assert.equal((await queries.detail(NO_FILTERS, ALL_STATES, "uf", 1)).rows[0].area, null);
assert.notEqual((await queries.detail(NO_FILTERS, ALL_STATES, "ano", 1)).rows[0].area, null);
assert.notEqual((await queries.summary({ ...NO_FILTERS, year: 2024 }, ALL_STATES)).area, null);
console.log("OK, a área só aparece com um ano.");

// A API abre no ano mais recente; somar todos é pedido explícito.
const latest = await (await fetch(`${API_URL}/summary`)).json();
assert.equal(latest.firstYear, latest.lastYear);
const accumulated = await (await fetch(`${API_URL}/summary?ano=todos`)).json();
assert.notEqual(accumulated.firstYear, accumulated.lastYear);
console.log("OK, abre no ano mais recente.");

// A ordem da tabela muda de verdade.
const ascending = await (await fetch(`${API_URL}/detail?por=uf&ordem=nome&dir=asc`)).json();
assert.equal(ascending.rows[0].label, "Acre");
const byArea = await (await fetch(`${API_URL}/detail?ordem=area&dir=desc`)).json();
assert.ok(Number(byArea.rows[0].area) >= Number(byArea.rows[1].area));
const portuguese = await (await fetch(`${API_URL}/detail?por=uf&ordem=nome&dir=asc&pagina=1`)).json();
const names: string[] = portuguese.rows.map((r: { label: string }) => r.label);
assert.ok(names.indexOf("Pará") < names.indexOf("Paraíba") && names.indexOf("Paraíba") < names.indexOf("Paraná"), names.join());
const hiddenOrder = await (await fetch(`${API_URL}/detail?por=uf&ano=todos&ordem=area&dir=desc`)).json();
const byValue = await (await fetch(`${API_URL}/detail?por=uf&ano=todos`)).json();
assert.deepEqual(hiddenOrder.rows.map((r: { label: string }) => r.label), byValue.rows.map((r: { label: string }) => r.label));
const allYears = await (await fetch(`${API_URL}/detail?por=ano`)).json();
assert.equal(allYears.rows.length, 10);
assert.equal(byValue.count, 27);
console.log("OK, a tabela ordena no servidor, em português, e coluna oculta não ordena.");

// Lista de UF limitada à região.
const south = await (await fetch(`${API_URL}/filter-options?regiao=Sul`)).json();
assert.deepEqual(south.uf.map((o: { label: string }) => o.label), ["Paraná", "Rio Grande do Sul", "Santa Catarina"]);
assert.equal(south.regiao.length, 5);
console.log("OK, os seletores respeitam o recorte.");

for (const path of ["/%", "//", "/api/%", "/%E0%A4%A"]) {
  const response = await fetch(SERVER + path).catch(() => null);
  assert.ok(response === null || response.status < 500, path);
}
assert.equal(await status("/summary"), 200);
assert.equal(await status("/detail?por=constructor"), 400);
assert.equal(await status("/by-state?uf=51&uf=35"), 400);
console.log("OK, endereço malformado e parâmetro estranho não derrubam o servidor.");

await reader.end();
console.log("Travas conferidas.");
