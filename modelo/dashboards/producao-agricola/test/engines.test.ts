// As mesmas linhas, escritas à mão, nos dois motores: o resultado precisa ser o escrito aqui, byte a byte.
// O SQLite roda em um arquivo temporário. O Postgres é um embedded-postgres descartável, em uma pasta temporária,
// com senha sorteada, sem tocar no banco de desenvolvimento. Se ele não puder subir, os testes dele ficam marcados como pulados, com o motivo.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import pg from "pg";
import { divide, scaledText } from "../../../server/db/decimal.ts";
import { readerAccess } from "../../../server/db/open.ts";
import { createSqliteFile, openSqlite, writeRows } from "../../../server/db/sqlite.ts";
import { producaoAgricola } from "../dashboard.ts";
import { DB } from "../db.ts";
import type { Db } from "../../../server/db/types.ts";
import { ALL_STATES, BadRequest, Forbidden, NO_FILTERS, readDetail, type DetailDimension, type Filters } from "../domain/filters.ts";
import { createQueries } from "../domain/queries.ts";
import { createDataRoutes } from "../domain/routes.ts";
import { postgresStore, sqliteStore, type LoadStore } from "../load/store.ts";
import type { Production } from "../load/sidra.ts";
import { detailTitle, totalLabel } from "../web/screenRules.ts";

type Row = Record<string, unknown>;

/** O arquivo do dashboard, com o mês e a escala do valor que o caso pede. */
const createDashboardFile = (file: string, options: { month?: boolean; valueScale?: number } = {}) =>
  createSqliteFile(file, producaoAgricola.sqlite({ MONTH_FILTER: options.month ? "on" : "", SQLITE_VALUE_SCALE: options.valueScale ? String(options.valueScale) : "" }));
const readerOf = (file: string) => openSqlite(file, readerAccess(DB));
const SCHEMA_OPTIONS = { options: `-c search_path=${DB.schema}` };
const SQL = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), "utf8");
/** No Postgres, cada banco de teste leva o schema do dashboard, como o de verdade: as consultas não levam prefixo. */
const withSchema = async (client: pg.Client) => {
  await client.query(`CREATE SCHEMA ${DB.schema}`);
  await client.query(`SET search_path = ${DB.schema}`);
};

const SCOPE = ["41", "42", "43", "15", "25", "51", "35"];
const line = (year: number, state: string, stateName: string, region: string, crop: string, cropName: string, value: string | null, quantity: string | null, area: string | null): Row => ({
  year, state_code: state, state_name: stateName, region, crop_code: crop, crop_name: cropName, value_brl: value, quantity_t: quantity, quantity_unit: crop === "9" ? "a verificar" : "t", area_ha: area,
});

// Nomes que testam a ordem de dicionário, empate de valor, zero, nulo e centavos.
const ROWS: Row[] = [
  line(2024, "41", "Paraná", "Sul", "1", "Soja", "100.00", "10.500", "1.250"),
  line(2024, "15", "Pará", "Norte", "1", "Soja", "100.00", "20.000", "2.000"),
  line(2024, "25", "Paraíba", "Nordeste", "1", "Soja", "33.33", "1.001", "0.500"),
  line(2024, "51", "Mato Grosso", "Centro-Oeste", "2", "Açaí", "66.67", "2.000", "1.000"),
  line(2024, "35", "São Paulo", "Sudeste", "3", "Abacate", "0.00", "0.000", "0.000"),
  line(2024, "42", "Santa Catarina", "Sul", "4", "Erva-mate", null, null, null),
  line(2024, "43", "Rio Grande do Sul", "Sul", "5", "Erva doce", "0.01", "0.001", "0.001"),
  line(2023, "41", "Paraná", "Sul", "1", "Soja", "150.00", "11.000", "1.500"),
  line(2023, "15", "Pará", "Norte", "1", "Soja", "50.00", "19.000", "1.900"),
  line(2023, "51", "Mato Grosso", "Centro-Oeste", "6", "Abóbora", "100.00", "3.000", "1.100"),
  line(2022, "41", "Paraná", "Sul", "9", "Coco-da-baía (unidade a verificar)", "7.77", "7.000", "0.700"),
];
// Mais de duas páginas no detalhe, sempre com o mesmo valor, para o desempate decidir.
for (let i = 0; i < 45; i++) ROWS.push(line(2021, "41", "Paraná", "Sul", String(100 + i), `Lavoura ${String(i).padStart(2, "0")}`, "1.00", "1.000", "1.000"));

const NATIONAL: Row[] = [
  { year: 2024, crop_code: "0", value_brl: "300.00", quantity_t: null, area_ha: "4.751" },
  { year: 2024, crop_code: "1", value_brl: "233.33", quantity_t: "31.501", area_ha: null },
  { year: 2024, crop_code: "2", value_brl: "66.67", quantity_t: "2.000", area_ha: null },
];
const LOG = { entity: "teste", started_at: "2026-10-30T10:00:00.000Z", finished_at: "2026-10-30T10:01:00.123Z", status: "ok" };

// O mês: dois anos, um deles incompleto e com menos meses no ano anterior.
const monthly = (year: number, month: number, crop: string, value: string): Row => ({ ...line(year, "41", "Paraná", "Sul", crop, crop === "1" ? "Soja" : "Milho", value, "1.000", "1.000"), month });
const MONTH_ROWS: Row[] = [
  monthly(2023, 1, "1", "10.1234"), monthly(2023, 2, "1", "20.0000"), monthly(2023, 3, "2", "5.5000"),
  monthly(2024, 1, "1", "11.0000"), monthly(2024, 2, "1", "22.5000"), monthly(2024, 3, "1", "3.0001"),
];

type Engine = {
  name: string;
  reader: Db;
  monthReader: Db;
  close(): Promise<void>;
  /** A carga em um banco próprio, sem dado, com ou sem a coluna do mês. */
  openStore(month: boolean): Promise<{ store: LoadStore; reader: Db; close(): Promise<void> }>;
  /** Só no Postgres: confere a divisão contra o próprio banco. */
  raw?: pg.Client;
};

const freePort = () => new Promise<number>((resolve) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});

const dir = mkdtempSync(path.join(tmpdir(), "dash-engines-test-"));

async function startSqlite(): Promise<Engine> {
  const fill = (file: string, rows: Row[], options: { month?: boolean; valueScale?: number }, national: Row[]) => {
    createDashboardFile(file, options);
    const admin = openSqlite(file, null);
    const db = admin.handle();
    db.exec("BEGIN");
    writeRows(db, "production", rows);
    writeRows(db, "source_national", national);
    writeRows(db, "load_log", [LOG]);
    db.exec("COMMIT");
    return admin.end();
  };
  const annual = path.join(dir, "anual.sqlite");
  const month = path.join(dir, "mes.sqlite");
  await fill(annual, ROWS, {}, NATIONAL);
  await fill(month, MONTH_ROWS, { month: true, valueScale: 4 }, []);
  const reader = readerOf(annual);
  const monthReader = readerOf(month);
  const openStore = async (hasMonth: boolean) => {
    const file = path.join(dir, `carga-${randomBytes(4).toString("hex")}.sqlite`);
    createDashboardFile(file, { month: hasMonth });
    const store = await sqliteStore(file);
    const storeReader = readerOf(file);
    return { store, reader: storeReader, close: async () => { await store.close(); await storeReader.end(); } };
  };
  return { name: "SQLite", reader, monthReader, openStore, close: async () => { await reader.end(); await monthReader.end(); } };
}

async function startPostgres(): Promise<Engine> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const port = await freePort();
  const password = randomBytes(12).toString("hex");
  const server = new EmbeddedPostgres({
    databaseDir: path.join(dir, "postgres"), user: "teste", password, port, persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("anual");
  await server.createDatabase("mes");
  const url = (database: string) => `postgres://teste:${password}@127.0.0.1:${port}/${database}`;
  const insert = async (client: pg.Client, table: string, rows: Row[]) => {
    for (const row of rows) {
      const columns = Object.keys(row);
      await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((column) => row[column]));
    }
  };
  const schema = SQL("001_schema.sql");
  const annual = new pg.Client({ connectionString: url("anual") });
  await annual.connect();
  await withSchema(annual);
  await annual.query(schema);
  await insert(annual, "production", ROWS);
  await insert(annual, "source_national", NATIONAL);
  await insert(annual, "load_log", [LOG]);
  const month = new pg.Client({ connectionString: url("mes") });
  await month.connect();
  await withSchema(month);
  await month.query(schema);
  await month.query(SQL("optional_month.sql"));
  await month.query("ALTER TABLE production ALTER COLUMN value_brl TYPE NUMERIC(20, 4)");
  await insert(month, "production", MONTH_ROWS);
  await insert(month, "load_log", [LOG]);
  await month.end();
  const reader = new pg.Pool({ connectionString: url("anual"), ...SCHEMA_OPTIONS }) as unknown as Db;
  const monthReader = new pg.Pool({ connectionString: url("mes"), ...SCHEMA_OPTIONS }) as unknown as Db;
  const openStore = async (hasMonth: boolean) => {
    const database = `carga_${randomBytes(4).toString("hex")}`;
    await server.createDatabase(database);
    const client = new pg.Client({ connectionString: url(database) });
    await client.connect();
    await withSchema(client);
    await client.query(schema);
    if (hasMonth) await client.query(SQL("optional_month.sql"));
    await client.end();
    const store = await postgresStore(url(database));
    const storeReader = new pg.Pool({ connectionString: url(database), ...SCHEMA_OPTIONS }) as unknown as Db & { end(): Promise<void> };
    return { store, reader: storeReader, close: async () => { await store.close(); await storeReader.end(); } };
  };
  return {
    name: "Postgres", reader, monthReader, raw: annual, openStore,
    close: async () => {
      await reader.end();
      await monthReader.end();
      await annual.end();
      await server.stop();
    },
  };
}

const engines: Engine[] = [];
let postgresSkip: string | false = false;

before(async () => {
  engines.push(await startSqlite());
  try {
    engines.push(await startPostgres());
  } catch (error) {
    postgresSkip = `Postgres descartável não subiu: ${error instanceof Error ? error.message : error}`;
  }
}, { timeout: 120_000 });

after(async () => {
  for (const engine of engines) await engine.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Roda o mesmo caso nos dois motores. Sem o Postgres, avisa na saída, sem esconder. */
function both(name: string, body: (engine: Engine, queries: ReturnType<typeof createQueries>, month: ReturnType<typeof createQueries>) => Promise<void>) {
  test(name, async (t) => {
    if (postgresSkip) t.diagnostic(postgresSkip);
    assert.ok(engines.length >= 1);
    for (const engine of engines) {
      await t.test(engine.name, () => body(engine, createQueries(engine.reader), createQueries(engine.monthReader, { hasMonth: true })));
    }
  });
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const filters = (change: Partial<Filters> = {}): Filters => ({ ...NO_FILTERS, ...change });

both("cartões: soma em decimal, variação e lista que mudou", async (_, queries) => {
  const summary = await queries.summary(filters({ year: 2024 }), SCOPE);
  assert.deepEqual(json(summary), {
    addedCrops: 4, addedValue: "66.68", removedCrops: 1, listChanged: true,
    value: "300.01", quantity: null, quantityUnit: null, area: "4.751", crops: 5, firstYear: 2024, lastYear: 2024,
    previousValue: "300.00", valueVariation: "0.00003333333333333333",
  });
  const south = await queries.summary(filters({ year: 2024, region: "Sul" }), SCOPE);
  assert.equal(south.value, "100.01");
  assert.equal(south.previousValue, "150.00");
  assert.equal(south.valueVariation, "-0.33326666666666666667");
  const soy = await queries.summary(filters({ year: 2024, crop: "1" }), SCOPE);
  assert.equal(soy.quantity, "31.501");
  assert.equal(soy.quantityUnit, "t");
  assert.equal(soy.valueVariation, "0.1666500000000000");
});

both("zero e nulo continuam distintos, e divisão por zero não existe", async (_, queries) => {
  const none = await queries.summary(filters({ year: 2024, crop: "4" }), SCOPE);
  assert.equal(none.value, null);
  assert.equal(none.quantity, null);
  assert.equal(none.valueVariation, null);
  const zero = await queries.summary(filters({ year: 2024, crop: "3" }), SCOPE);
  assert.equal(zero.value, "0.00");
  assert.equal(zero.quantity, "0.000");
  assert.equal(zero.previousValue, null);
  assert.equal(zero.valueVariation, null);
  assert.deepEqual(json(await queries.byRegion(filters({ year: 2024, crop: "3" }), SCOPE)), { rows: [{ key: "Sudeste", label: "Sudeste", value: "0.00", share: null }], total: "0.00" });
});

both("sem permissão, sem linhas, e lista de permissão limita tudo", async (_, queries) => {
  const empty = await queries.summary(filters({ year: 2024 }), []);
  assert.equal(empty.value, null);
  assert.deepEqual((await queries.byState(filters(), [])).rows, []);
  assert.deepEqual(json((await queries.byState(filters({ year: 2024 }), ["51"])).rows), [{ key: "51", label: "Mato Grosso", value: "66.67" }]);
  assert.deepEqual((await queries.byState(filters({ state: "35" }), ["51"])).rows, []);
});

both("regiões: participação em NUMERIC, com o maior primeiro e desempate pelo nome", async (_, queries) => {
  assert.deepEqual(json(await queries.byRegion(filters({ year: 2024 }), SCOPE)), {
    rows: [
      { key: "Norte", label: "Norte", value: "100.00", share: "0.33332222259258024733" },
      { key: "Sul", label: "Sul", value: "100.01", share: "0.33335555481483950535" },
      { key: "Centro-Oeste", label: "Centro-Oeste", value: "66.67", share: "0.22222592580247325089" },
      { key: "Nordeste", label: "Nordeste", value: "33.33", share: "0.11109629679010699643" },
      { key: "Sudeste", label: "Sudeste", value: "0.00", share: "0.00000000000000000000" },
    ].sort((a, b) => Number(b.value) - Number(a.value)),
    total: "300.01",
  });
});

both("UFs e lavouras: empate decidido pelo código, e nulo por último", async (_, queries) => {
  assert.deepEqual((await queries.byState(filters({ year: 2024 }), SCOPE)).rows.map((row) => row.key), ["15", "41", "51", "25", "43", "35", "42"]);
  const crops = await queries.byCrop(filters({ year: 2021 }), SCOPE);
  assert.equal(crops.rows.length, 11);
  assert.deepEqual(crops.rows.slice(0, 2).map((row) => row.key), ["100", "101"]);
  assert.deepEqual(json(crops.rows.at(-1)), { key: null, label: "Outros", value: "35.00" });
});

both("anos: todos na lista, com região e total", async (_, queries) => {
  assert.deepEqual(json(await queries.byYear(filters({ region: "Norte" }), SCOPE)), {
    categories: ["2021", "2022", "2023", "2024"],
    series: [{ key: "Norte", label: "Norte", values: [null, null, "50.00", "100.00"] }],
    totals: [null, null, "50.00", "100.00"],
  });
});

const order = (query: string) => {
  const { by, page, order: sql } = readDetail(new URLSearchParams(query));
  return { by: by as DetailDimension | null, page, sql };
};

both("detalhe por linha: ordem de dicionário, página e desempate", async (_, queries) => {
  const names = async (query: string, change: Partial<Filters>) => {
    const { by, page, sql } = order(query);
    return (await queries.detail(filters(change), SCOPE, by, page, sql)).rows.map((row: Row) => row.state_name);
  };
  assert.deepEqual(await names("ordem=uf&dir=asc", { year: 2024 }), ["Mato Grosso", "Pará", "Paraíba", "Paraná", "Rio Grande do Sul", "Santa Catarina", "São Paulo"]);
  assert.deepEqual(await names("ordem=uf&dir=desc", { year: 2024 }), ["São Paulo", "Santa Catarina", "Rio Grande do Sul", "Paraná", "Paraíba", "Pará", "Mato Grosso"]);
  const crops = await queries.detail(filters({ year: 2024 }), SCOPE, null, 1, order("ordem=lavoura&dir=asc").sql);
  assert.deepEqual(crops.rows.map((row: Row) => row.crop_name), ["Abacate", "Açaí", "Erva doce", "Erva-mate", "Soja", "Soja", "Soja"]);

  const first = await queries.detail(filters({ year: 2021 }), SCOPE, null, 1);
  assert.equal(first.count, 45);
  assert.deepEqual(json(first.rows[0]), { year: 2021, state_name: "Paraná", region: "Sul", crop_name: "Lavoura 00", value: "1.00", quantity: "1.000", quantity_unit: "t", area: "1.000" });
  assert.equal((await queries.detail(filters({ year: 2021 }), SCOPE, null, 3)).rows.length, 5);
  assert.equal((await queries.detail(filters({ year: 2021 }), SCOPE, null, 4)).rows.length, 0);
  assert.deepEqual(json(first.totals), { value: "45.00", quantity: null, area: "45.000", lines: 45, firstYear: 2021, lastYear: 2021, quantityUnit: null });

  const nullLast = await queries.detail(filters({ year: 2024 }), SCOPE, null, 1, order("ordem=valor&dir=asc").sql);
  assert.equal(nullLast.rows.at(-1).value, null);
  assert.equal(nullLast.rows[0].value, "0.00");
});

both("detalhe por grupo, em todas as dimensões, com ordem pelo nome e pela soma", async (_, queries) => {
  const list = async (query: string, change: Partial<Filters> = {}) => {
    const { by, page, sql } = order(query);
    return queries.detail(filters(change), SCOPE, by, page, sql);
  };
  assert.deepEqual((await list("por=uf&ordem=nome&dir=asc", { year: 2024 })).rows.map((row: Row) => row.label), ["Mato Grosso", "Pará", "Paraíba", "Paraná", "Rio Grande do Sul", "Santa Catarina", "São Paulo"]);
  assert.deepEqual((await list("por=lavoura&ordem=nome&dir=desc", { year: 2024 })).rows.map((row: Row) => row.label), ["Soja", "Erva-mate", "Erva doce", "Açaí", "Abacate"]);
  assert.deepEqual((await list("por=regiao&ordem=nome&dir=asc", { year: 2024 })).rows.map((row: Row) => row.key), ["Centro-Oeste", "Nordeste", "Norte", "Sudeste", "Sul"]);
  const years = await list("por=ano&ordem=nome&dir=desc");
  assert.deepEqual(json(years.rows[0]), { key: "2024", label: "2024", value: "300.01", quantity: null, quantity_unit: "t", area: "4.751" });
  assert.deepEqual(json((await list("por=uf&ordem=valor&dir=desc", { year: 2024 })).rows.map((row: Row) => [row.key, row.value])), [["15", "100.00"], ["41", "100.00"], ["51", "66.67"], ["25", "33.33"], ["43", "0.01"], ["35", "0.00"], ["42", null]]);
  assert.deepEqual((await list("por=lavoura&ordem=quantidade&dir=asc", { year: 2024 })).rows.map((row: Row) => row.quantity), ["0.000", "0.001", "2.000", "31.501", null]);
  assert.equal((await list("por=lavoura", { year: 2021 })).count, 45);
  assert.equal((await list("por=lavoura&pagina=3", { year: 2021 })).rows.length, 5);
});

both("seletores e nomes da permissão", async (_, queries) => {
  const options = json(await queries.filterOptions(SCOPE, filters({ year: 2024 })));
  assert.deepEqual(options.ano.map((o: { key: string }) => o.key), ["2024", "2023", "2022", "2021"]);
  assert.deepEqual(options.uf.map((o: { label: string }) => o.label), ["Mato Grosso", "Pará", "Paraíba", "Paraná", "Rio Grande do Sul", "Santa Catarina", "São Paulo"]);
  assert.deepEqual(options.lavoura.slice(0, 3).map((o: { label: string }) => o.label), ["Abacate", "Açaí", "Erva doce"]);
  assert.equal(options.scopeLabel, "7 UFs permitidas");
  assert.equal(options.firstYear, 2021);
  assert.equal(options.latestYear, 2024);
  assert.equal(options.hasAccess, true);
  assert.equal((await queries.filterOptions(["51"])).scopeLabel, "Mato Grosso");
  assert.equal((await queries.filterOptions([])).hasAccess, false);
});

both("existência: o que só há fora da permissão é igual ao que não existe, e sem permissão nada é recusado", async (_, queries, month) => {
  assert.deepEqual(await queries.exists(filters({ crop: "2" }), ["41"]), { year: true, crop: false, month: true }, "Açaí só existe em MT");
  assert.deepEqual(await queries.exists(filters({ crop: "2" }), ["51"]), { year: true, crop: true, month: true });
  assert.deepEqual(await queries.exists(filters({ year: 2022 }), ["51"]), { year: false, crop: true, month: true }, "2022 só existe no PR");
  assert.deepEqual(await queries.exists(filters({ year: 2022 }), ["41"]), { year: true, crop: true, month: true });
  assert.deepEqual(await month.exists(filters({ year: 2024, month: 3 }), ["41"]), { year: true, crop: true, month: true });
  assert.deepEqual(await queries.exists(filters({ year: 1999, crop: "99999" }), []), { year: true, crop: true, month: true });
  assert.deepEqual(await queries.exists(filters({ year: 2024, crop: "1" }), ["99"]), { year: true, crop: true, month: true }, "permissão só em UF sem dado é o mesmo que sem acesso");
});

both("rotas: a recusa de fora da permissão é a mesma de um valor que não existe", async (engine, queries) => {
  const { routes } = createDataRoutes(queries, false);
  const refusal = (route: Promise<unknown>) => route.then(() => null, (error) => {
    assert.ok(error instanceof BadRequest, String(error));
    return error.message;
  });
  const ask = (query: string, scope: string[]) => refusal(routes.summary(new URLSearchParams(query), scope));
  assert.equal(await ask("lavoura=2", ["41"]), "Lavoura inválida.");
  assert.equal(await ask("lavoura=99999", ["41"]), "Lavoura inválida.");
  assert.equal(await ask("lavoura=2", ["51"]), null);
  assert.equal(await ask("ano=2022", ["51"]), "Ano inválido.");
  assert.equal(await ask("ano=1999", ["51"]), "Ano inválido.");
  // O mês: março só no Paraná, julho só em Mato Grosso.
  const { store, reader, close } = await engine.openStore(true);
  const row = (state: string, name: string, region: string, value: number) => ({ ...line(2024, state, name, region, "1", "Soja", "1.00", "1.000", "1.000"), month: value }) as unknown as Production;
  await store.replace(await store.start(), { raw: [], production: [row("41", "Paraná", "Sul", 3), row("51", "Mato Grosso", "Centro-Oeste", 7)], national: [] });
  const scoped = createQueries(reader, { hasMonth: true });
  assert.deepEqual(await scoped.exists(filters({ year: 2024, month: 7 }), ["41"]), { year: true, crop: true, month: false });
  assert.deepEqual(await scoped.exists(filters({ year: 2024, month: 3 }), ["41"]), { year: true, crop: true, month: true });
  const monthly = createDataRoutes(scoped, true).routes;
  assert.equal(await refusal(monthly.summary(new URLSearchParams("ano=2024&mes=7"), ["41"])), "Mês inválido.");
  assert.equal(await refusal(monthly.summary(new URLSearchParams("ano=2024&mes=9"), ["41"])), "Mês inválido.");
  assert.equal(await refusal(monthly.summary(new URLSearchParams("ano=2024&mes=7"), ["51"])), null);
  await close();
});

both("conferência: só com acesso total", async (_, queries) => {
  const { check } = createDataRoutes(queries, false);
  await assert.rejects(check(["51"]), Forbidden);
  await assert.rejects(check([]), Forbidden);
  assert.ok(Array.isArray((await check(ALL_STATES)).rows));
});

both("detalhe: \"Por ano\" sem ano escolhido soma todos os anos e diz o intervalo. As outras visões ficam no mais recente", async (_, queries) => {
  const { routes } = createDataRoutes(queries, false);
  const ask = async (query: string) => routes.detail(new URLSearchParams(query), SCOPE) as Promise<{ rows: { key: string }[]; totals: Record<string, unknown> }>;
  const byYear = await ask("por=ano");
  assert.deepEqual(byYear.rows.map((row) => row.key).sort(), ["2021", "2022", "2023", "2024"]);
  assert.equal(byYear.totals.firstYear, 2021);
  assert.equal(byYear.totals.lastYear, 2024);
  assert.equal(byYear.totals.value, "652.78");
  assert.equal(detailTitle(byYear.totals, "2024 · Brasil", ["Brasil"]), "Detalhe · acumulado de 2021 a 2024 · Brasil");
  assert.equal(totalLabel(byYear.totals), "Total acumulado de 2021 a 2024");
  // Nenhuma outra dimensão ignora o ano: o total é o do ano mais recente, e o título diz esse ano.
  const year2024 = await routes.summary(new URLSearchParams("ano=2024"), SCOPE) as { value: string };
  for (const view of ["regiao", "uf", "lavoura"]) {
    const other = await ask(`por=${view}`);
    assert.equal(other.totals.firstYear, 2024, view);
    assert.equal(other.totals.lastYear, 2024, view);
    assert.equal(other.totals.value, year2024.value, view);
  }
  // Com o ano escolhido, "Por ano" tem uma linha só.
  const chosen = await ask("por=ano&ano=2023");
  assert.deepEqual(chosen.rows.map((row) => row.key), ["2023"]);
  assert.equal(detailTitle(chosen.totals, "x", ["Brasil"]), "Detalhe · 2023 · Brasil");
  // Todos os anos, em qualquer visão, também é acumulado.
  assert.equal(totalLabel((await ask("por=uf&ano=todos")).totals), "Total acumulado de 2021 a 2024");
  assert.equal(totalLabel((await ask("ano=todos")).totals), "Total acumulado de 2021 a 2024");
});

both("detalhe com o mês: o intervalo vem em meses, e \"Por mês\" fica no ano mais recente", async (_, __, month) => {
  const { routes } = createDataRoutes(month, true);
  const ask = async (query: string) => routes.detail(new URLSearchParams(query), SCOPE) as Promise<{ rows: { key: string }[]; totals: Record<string, unknown> }>;
  const byYear = await ask("por=ano");
  assert.equal(detailTitle(byYear.totals, "x", ["Paraná"]), "Detalhe · acumulado de jan/23 a mar/24, 6 meses · Paraná");
  assert.equal(totalLabel(byYear.totals), "Total acumulado de jan/23 a mar/24, 6 meses");
  const byMonth = await ask("por=mes");
  assert.deepEqual(byMonth.rows.map((row) => row.key).sort(), ["2024-01", "2024-02", "2024-03"]);
  assert.equal(detailTitle(byMonth.totals, "x", ["Paraná"]), "Detalhe · 2024, jan a mar · Paraná");
  assert.equal(totalLabel(byMonth.totals), "Total");
  assert.equal(detailTitle((await ask("por=uf&ano=2024&mes=3")).totals, "x", ["Paraná"]), "Detalhe · mar/24 · Paraná");
  assert.equal(detailTitle((await ask("por=lavoura")).totals, "x", ["Paraná"]), "Detalhe · 2024, jan a mar · Paraná");
});

both("mês: a lista de lavouras compara mês a mês, e não só o ano inteiro", async (_, __, month) => {
  // Em março, a soja entra e o milho sai, mesmo a soja existindo no ano anterior em outros meses.
  const summary = await month.summary(filters({ year: 2024 }), SCOPE);
  assert.equal(summary.addedCrops, 1);
  assert.equal(summary.addedValue, "3.0001");
  assert.equal(summary.removedCrops, 1);
  assert.equal(summary.listChanged, true);
});

both("carga: grava o mês quando a coluna existe e a linha traz, e recusa a mistura, sem perder o dado anterior", async (engine) => {
  const row = (month?: number, value = "10.50") => ({ ...line(2024, "41", "Paraná", "Sul", "1", "Soja", value, "1.000", "1.000"), ...(month === undefined ? {} : { month }) }) as unknown as Production;
  const prepared = (production: Production[]) => ({ raw: [], production, national: [] });
  const byMonth = await engine.openStore(true);
  await byMonth.store.replace(await byMonth.store.start(), prepared([row(3), row(7, "20.25")]));
  const monthly = createQueries(byMonth.reader, { hasMonth: true });
  assert.deepEqual((await monthly.byMonth(filters({ year: 2024 }), SCOPE)).rows.map((r) => [r.key, r.value]), [["3", "10.50"], ["7", "20.25"]]);
  assert.equal((await monthly.summary(filters({ year: 2024 }), SCOPE)).monthsCurrent, 2);
  // Dois meses, de março a julho: o título do detalhe diz que faltam, com o número que vem da API.
  const detail = await createDataRoutes(monthly, true).routes.detail(new URLSearchParams("ano=2024&por=uf"), SCOPE) as { totals: Record<string, unknown> };
  assert.equal(detailTitle(detail.totals, "x", ["Paraná"]), "Detalhe · 2024, 2 meses · Paraná");
  await assert.rejects(byMonth.store.replace(await byMonth.store.start(), prepared([row(3), row()])), /linhas sem o mês: 1 de 2/);
  assert.equal((await monthly.summary(filters({ year: 2024 }), SCOPE)).monthsCurrent, 2, "o dado anterior continua");
  await byMonth.close();

  const yearly = await engine.openStore(false);
  await yearly.store.replace(await yearly.store.start(), prepared([row()]));
  assert.equal((await createQueries(yearly.reader).summary(filters({ year: 2024 }), SCOPE)).value, "10.50");
  await assert.rejects(yearly.store.replace(await yearly.store.start(), prepared([row(3)])), /não tem a coluna month/);
  assert.equal((await createQueries(yearly.reader).summary(filters({ year: 2024 }), SCOPE)).value, "10.50", "o dado anterior continua");
  await yearly.close();
});

both("existência de filtro e ano mais recente", async (_, queries) => {
  assert.deepEqual(await queries.exists(filters({ year: 2024, crop: "1" }), SCOPE), { year: true, crop: true, month: true });
  assert.deepEqual(await queries.exists(filters({ year: 1999, crop: "99999" }), SCOPE), { year: false, crop: false, month: true });
  assert.equal(await queries.latestYear(["51"]), 2024);
  assert.equal(await queries.latestYear([]), null);
});

both("última carga, com data em ISO", async (_, queries) => {
  const meta = await queries.meta();
  assert.equal(meta.updatedAt, "2026-10-30T10:01:00.123Z");
});

both("conferência: diferença em decimal, lavoura a mais e situação", async (_, queries) => {
  const rows = json(await queries.sourceCheck());
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { indicator: "Valor da produção, Brasil (R$)", kind: "money", year: 2024, source: "300.00", dashboard: "300.01", difference: "0.01", tolerance: "27000", status: "OK" });
  assert.deepEqual(rows[1], { indicator: "Área colhida, Brasil (ha)", kind: "area", year: 2024, source: "4.751", dashboard: "4.751", difference: "0.000", tolerance: "0", status: "OK" });
  // Abacate, erva-mate e erva doce estão só no dashboard. Soja e açaí batem.
  assert.equal(rows[3].dashboard, "3");
  assert.equal(rows[4].source, "2");
  assert.equal(rows[4].dashboard, "5");
});

both("mês ligado: comparação com os mesmos meses, mês na tabela e escala de 4 casas", async (_, __, month) => {
  const summary = await month.summary(filters({ year: 2024, month: 2 }), SCOPE);
  assert.equal(summary.value, "22.5000");
  assert.equal(summary.previousValue, "20.0000");
  assert.equal(summary.valueVariation, "0.1250000000000000");
  assert.equal(summary.firstPeriod, "2024-02");
  assert.equal(summary.lastPeriod, "2024-02");
  const year = await month.summary(filters({ year: 2024 }), SCOPE);
  assert.equal(year.value, "36.5001");
  assert.equal(year.previousValue, "35.6234");
  assert.equal(year.monthsCurrent, 3);
  assert.equal(year.monthsPrevious, 3);
  const crop = await month.summary(filters({ year: 2024, crop: "1" }), SCOPE);
  assert.equal(crop.valueVariation, null);
  assert.equal(crop.monthsPrevious, 2);
  assert.deepEqual(json(await month.byMonth(filters({ year: 2024, month: 2 }), SCOPE)).rows.map((row: { key: string; value: string }) => [row.key, row.value]), [["1", "11.0000"], ["2", "22.5000"], ["3", "3.0001"]]);
  assert.deepEqual(json(await month.byYear(filters({ crop: "2" }), SCOPE)).partial, { 2023: { months: 1, first: 3, last: 3 } });
  const options = json(await month.filterOptions(SCOPE, filters({ year: 2024 })));
  assert.deepEqual(options.mes.map((o: { key: string }) => o.key), ["1", "2", "3"]);
  assert.deepEqual(options.monthsByYear, { 2023: [1, 2, 3], 2024: [1, 2, 3] });
  const { order: sql } = readDetail(new URLSearchParams("ordem=mes&dir=desc"), true);
  const lines = await month.detail(filters({ year: 2024 }), SCOPE, null, 1, sql);
  assert.deepEqual(lines.rows.map((row: Row) => row.month), [3, 2, 1]);
  const byMonth = await month.detail(filters({ year: 2024 }), SCOPE, "mes", 1, readDetail(new URLSearchParams("por=mes&ordem=nome&dir=asc"), true).order);
  assert.deepEqual(byMonth.rows.map((row: Row) => [row.key, row.value]), [["2024-01", "11.0000"], ["2024-02", "22.5000"], ["2024-03", "3.0001"]]);
  assert.equal(byMonth.count, 3);
});

test("soma além de 64 bits e ordem dela, com o mesmo texto nos dois motores", async (t) => {
  if (postgresSkip) t.diagnostic(postgresSkip);
  const big: Row[] = [
    line(2024, "41", "Paraná", "Sul", "1", "Soja", "90000000000000000.00", "1.000", "1.000"),
    line(2024, "42", "Santa Catarina", "Sul", "1", "Soja", "90000000000000000.00", "1.000", "1.000"),
    line(2024, "43", "Rio Grande do Sul", "Sul", "1", "Soja", "0.01", "1.000", "1.000"),
    line(2024, "15", "Pará", "Norte", "1", "Soja", "90000000000000000.00", "1.000", "1.000"),
    line(2023, "41", "Paraná", "Sul", "1", "Soja", "90000000000000000.00", "1.000", "1.000"),
  ];
  const results: string[] = [];
  const file = path.join(dir, "grande.sqlite");
  createDashboardFile(file);
  const admin = openSqlite(file, null);
  writeRows(admin.handle(), "production", big);
  await admin.end();
  const reader = readerOf(file);
  const compute = async (queries: ReturnType<typeof createQueries>) => JSON.stringify([
    await queries.byRegion(filters({ year: 2024 }), SCOPE),
    await queries.detail(filters(), SCOPE, "regiao", 1, order("por=regiao&ordem=valor&dir=asc").sql),
    (await queries.summary(filters({ year: 2024 }), SCOPE)).valueVariation,
  ]);
  results.push(await compute(createQueries(reader)));
  await reader.end();
  assert.match(results[0], /"total":"270000000000000000\.01"/);
  assert.match(results[0], /"value":"180000000000000000\.01","share":"0\.66666666666666666668"/);
  assert.match(results[0], /"2\.0000000000000000"/);

  const postgres = engines.find((engine) => engine.raw);
  if (postgres?.raw) {
    await postgres.raw.query("CREATE SCHEMA grande");
    await postgres.raw.query("SET search_path TO grande");
    await postgres.raw.query(SQL("001_schema.sql"));
    for (const row of big) {
      const columns = Object.keys(row);
      await postgres.raw.query(`INSERT INTO production (${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`, columns.map((column) => row[column]));
    }
    const shared = { query: (text: string, values?: unknown[]) => postgres.raw!.query(text, values as never), end: async () => {} } as Db;
    results.push(await compute(createQueries(shared)));
    await postgres.raw.query(`SET search_path TO ${DB.schema}`);
    await postgres.raw.query("DROP SCHEMA grande CASCADE");
    assert.equal(results[1], results[0]);
  }
});

test("divisão em BigInt contra o próprio Postgres, com pares sorteados", async (t) => {
  const client = engines.find((engine) => engine.raw)?.raw;
  if (!client) return t.skip(String(postgresSkip));
  // Sorteio com semente fixa: a mesma lista em toda execução, de centavos até o limite de NUMERIC(20,2).
  let seed = 5457n;
  const next = (): bigint => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    return seed;
  };
  const number = (): bigint => next() % 10n ** (next() % 20n + 1n);
  for (let i = 0; i < 2000; i++) {
    const a = i % 7 === 0 ? -number() : number();
    const b = number() || 1n;
    for (const scale of [0, 2, 3, 4, 5]) {
      const answer: pg.QueryResult<{ q: string; v: string }> = await client.query("SELECT ($1::numeric / $2::numeric)::text AS q, ($1::numeric / $2::numeric - 1)::text AS v", [scaledText(a, scale), scaledText(b, scale)]);
      const own = divide(a, b, scale);
      assert.equal(scaledText(own.quotient, own.scale), answer.rows[0].q, `${a} / ${b}, escala ${scale}`);
      assert.equal(scaledText(own.quotient - 10n ** BigInt(own.scale), own.scale), answer.rows[0].v, `${a} / ${b} - 1, escala ${scale}`);
    }
  }
});
