// O mês é opcional. Com poucas linhas escritas à mão, sem banco, rede nem dado real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fromScaled, parseMonthlyCsv, parseValue, toScaled, totalsBy } from "../../../scripts/monthly-csv.ts";
import { TOOLS, type AgentContext } from "../agent/tools.ts";
import { areaFits, BadRequest, NO_FILTERS, readDetail, readFilters, readMonthFilter, type Filters } from "../domain/filters.ts";
import { createQueries } from "../domain/queries.ts";
import { periodText } from "../../../shared/format.ts";
import { monthColumns, stackedByYear } from "../web/charts.ts";
import type { ByYear, Row } from "../web/types.ts";

test("a configuração só aceita ligado ou vazio", () => {
  assert.equal(readMonthFilter(undefined), false);
  assert.equal(readMonthFilter(""), false);
  assert.equal(readMonthFilter("on"), true);
  for (const value of ["true", "ON", "1", "off"]) assert.throws(() => readMonthFilter(value));
});

test("desligado, mes continua desconhecido e o filtro não ganha campo novo", () => {
  assert.throws(() => readFilters(new URLSearchParams("ano=2024&mes=3")), /Filtro desconhecido: mes/);
  assert.deepEqual(readFilters(new URLSearchParams("ano=2024")), { year: 2024, region: null, state: null, crop: null });
  assert.throws(() => readDetail(new URLSearchParams("por=mes")), BadRequest);
  assert.throws(() => readDetail(new URLSearchParams("ordem=mes")), BadRequest);
});

test("ligado, mes é lido junto com o ano", () => {
  assert.equal(readFilters(new URLSearchParams("ano=2024&mes=3"), [], true).month, 3);
  assert.equal(readFilters(new URLSearchParams("ano=2024"), [], true).month, null);
  assert.equal(readDetail(new URLSearchParams("por=mes"), true).by, "mes");
  assert.equal(readDetail(new URLSearchParams("ordem=mes&dir=asc"), true).order, "make_date(year, month, 1) ASC NULLS LAST");
});

test("mês sem ano é recusado", () => {
  assert.throws(() => readFilters(new URLSearchParams("mes=3"), [], true), /Escolha um ano/);
  assert.throws(() => readFilters(new URLSearchParams("ano=todos&mes=3"), [], true), /Escolha um ano/);
});

test("mês fora da lista é recusado", () => {
  for (const value of ["0", "13", "03", "3;DROP", "", "abc"]) {
    assert.throws(() => readFilters(new URLSearchParams(`ano=2024&mes=${value}`), [], true), BadRequest, value);
  }
  assert.throws(() => readFilters(new URLSearchParams("ano=2024&mes=1&mes=2"), [], true), /repetido/);
});

test("área só em um período por linha: o ano desligado, o mês ligado", () => {
  const year: Filters = { ...NO_FILTERS, year: 2024 };
  assert.equal(areaFits(year, null, false), true);
  assert.equal(areaFits(NO_FILTERS, null, false), false);
  assert.equal(areaFits(NO_FILTERS, "ano", false), true);
  assert.equal(areaFits({ ...year, month: null }, null, true), false);
  assert.equal(areaFits({ ...year, month: 3 }, null, true), true);
  assert.equal(areaFits(NO_FILTERS, "ano", true), false);
  assert.equal(areaFits(NO_FILTERS, "mes", true), true);
});

test("o período é escrito por extenso", () => {
  assert.equal(periodText("2026-09", "2026-09"), "set/26");
  assert.equal(periodText("2025-01", "2025-12"), "2025");
  assert.equal(periodText("2026-01", "2026-09"), "2026, jan a set");
  assert.equal(periodText("2000-01", "2026-09"), "acumulado de jan/00 a set/26");
  assert.equal(periodText("2024-01", "2026-09", 33), "acumulado de jan/24 a set/26", "sem lacuna, não fala de meses");
  assert.equal(periodText("2024-01", "2026-09", 31), "acumulado de jan/24 a set/26, 31 meses", "lacuna entre anos fica à vista");
  assert.equal(periodText("2026-01", "2026-09", 7), "2026, 7 meses");
  assert.equal(periodText(null, null), "—");
});

/** Banco falso: guarda o SQL e devolve a resposta da primeira regra que casa. */
function fakePool(answers: [RegExp, Record<string, unknown>[]][]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      sql.push(text);
      params.push(values);
      return { rows: answers.find(([pattern]) => pattern.test(text))?.[1] ?? [] };
    },
  };
  return { pool: pool as never, sql, params };
}

const SUMMARY_ROW = {
  added: 0, added_value: null, removed: 0, removed_value: null, value: "90", quantity: null, quantity_unit: "t", area: "5", crops: 1,
  first_year: 2026, last_year: 2026, previous_value: "60", value_variation: "0.5",
};
const SCOPE = ["51"];

test("desligado, nenhuma consulta cita a coluna de mês", async () => {
  const { pool, sql } = fakePool([
    [/WITH current AS/, [SUMMARY_ROW]],
    [/AS lines/, [{ value: "1", quantity: null, quantity_unit: "t", area: null, lines: 1 }]],
    [/SUM\(value_brl\)::text AS value/, []],
  ]);
  const queries = createQueries(pool);
  const summary = await queries.summary({ ...NO_FILTERS, year: 2026 }, SCOPE);
  await queries.byYear(NO_FILTERS, SCOPE);
  await queries.detail(NO_FILTERS, SCOPE, null, 1);
  assert.equal(summary.valueVariation, "0.5");
  assert.equal("monthsCurrent" in summary, false);
  assert.ok(sql.length >= 5);
  for (const text of sql) assert.doesNotMatch(text, /\bmonth\b/);
});

test("desligado, a resposta não ganha campo de mês", async () => {
  const { pool } = fakePool([[/MIN\(year\)/, [{ first: 2024, last: 2024 }]]]);
  const queries = createQueries(pool);
  const years = await queries.byYear(NO_FILTERS, SCOPE);
  assert.equal("partial" in years, false);
  const options = await queries.filterOptions(SCOPE);
  assert.equal("mes" in options, false);
  assert.equal("monthsByYear" in options, false);
});

test("ligado, a comparação só vale com os mesmos meses", async () => {
  const months = (current: number, previous: number) => [/AS previous_months/, [{ months: current, previous_months: previous, first_period: "2026-01", last_period: "2026-09" }]] as [RegExp, Record<string, unknown>[]];
  const main = [/WITH current AS \(\s+SELECT SUM/, [{ ...SUMMARY_ROW, listChanged: true }]] as [RegExp, Record<string, unknown>[]];

  const same = await createQueries(fakePool([main, months(9, 9)]).pool, { hasMonth: true }).summary({ ...NO_FILTERS, year: 2026 }, SCOPE);
  assert.equal(same.valueVariation, "0.5");
  assert.equal(same.firstPeriod, "2026-01");

  const fewer = await createQueries(fakePool([main, months(9, 4)]).pool, { hasMonth: true }).summary({ ...NO_FILTERS, year: 2026 }, SCOPE);
  assert.equal(fewer.valueVariation, null);
  assert.equal(fewer.previousValue, "60");
  assert.equal(fewer.monthsPrevious, 4);
});

test("ligado, o ano anterior se limita aos meses do período atual", async () => {
  const { pool, sql } = fakePool([[/AS previous_months/, [{ months: 1, previous_months: 1 }]], [/WITH current AS/, [SUMMARY_ROW]]]);
  await createQueries(pool, { hasMonth: true }).summary({ ...NO_FILTERS, year: 2026, month: 9 }, SCOPE);
  assert.match(sql[0], /AND month IN \(SELECT month FROM production WHERE/);
  assert.match(sql[0], /\$6::int IS NULL OR month = \$6::int/);
});

test("ligado, o gráfico de meses mostra o ano inteiro, mesmo com um mês escolhido", async () => {
  const { pool, params } = fakePool([
    [/SUM\(value_brl\)/, [{ month: 8, value: "10" }]],
    [/DISTINCT month/, [{ month: 8 }, { month: 9 }]],
  ]);
  const result = await createQueries(pool, { hasMonth: true }).byMonth({ ...NO_FILTERS, year: 2026, month: 9 }, SCOPE);
  assert.equal(params[0][5], null);
  assert.deepEqual(result.rows, [{ key: "8", label: "ago/26", value: "10" }, { key: "9", label: "set/26", value: null }]);
  assert.deepEqual((await createQueries(pool, { hasMonth: true }).byMonth(NO_FILTERS, SCOPE)).rows, []);
});

test("ligado, o seletor traz só os meses do recorte, sem se limitar ao mês escolhido", async () => {
  const { pool, params } = fakePool([
    [/SELECT DISTINCT month FROM production WHERE/, [{ month: 2 }, { month: 3 }]],
    [/array_agg/, [{ year: 2026, months: [2, 3] }]],
    [/MIN\(year\)/, [{ first: 2026, last: 2026 }]],
  ]);
  const options = await createQueries(pool, { hasMonth: true }).filterOptions(SCOPE, { ...NO_FILTERS, year: 2026, month: 3, crop: "9" });
  assert.deepEqual(options.mes, [{ key: "2", label: "fev/26" }, { key: "3", label: "mar/26" }]);
  assert.deepEqual(options.monthsByYear, { 2026: [2, 3] });
  const monthList = params.find((values) => values[0] === 2026 && values[3] === "9" && values[5] === null);
  assert.ok(monthList);
});

const TOKENS = { primary: "#111", text: "#222", series: ["#a", "#b", "#c", "#d", "#e"] } as never;
const YEARS: ByYear = {
  updatedAt: null, warnings: [], categories: ["2005", "2024", "2025", "2026"],
  series: [{ key: "Sul", label: "Sul", values: ["1", "2", "3", "4"] }], totals: ["1", "2", "3", "4"],
  partial: { 2005: { months: 3, first: 8, last: 10 }, 2024: { months: 3, first: 1, last: 12 }, 2026: { months: 9, first: 1, last: 9 } },
};

test("ano incompleto diz os meses no eixo", () => {
  const option = stackedByYear(YEARS, null, TOKENS, { narrow: false, rotate: false, selectedSeries: null });
  const label = (option.xAxis as { axisLabel: { formatter: (year: string) => string } }).axisLabel.formatter;
  assert.equal(label("2026"), "2026\naté set");
  assert.equal(label("2005"), "2005\nago a out");
  assert.equal(label("2024"), "2024\n3 meses");
  assert.equal(label("2025"), "2025");
});

test("desligado, o eixo de anos não ganha marca", () => {
  const { partial: _partial, ...annual } = YEARS;
  const option = stackedByYear(annual, null, TOKENS, { narrow: false, rotate: false, selectedSeries: null });
  assert.equal("formatter" in (option.xAxis as { axisLabel: object }).axisLabel, false);
});

test("no celular, muitos anos viram linhas, com o ano incompleto marcado", () => {
  const many: ByYear = { ...YEARS, categories: Array.from({ length: 13 }, (_, i) => String(2014 + i)), totals: Array(13).fill("1"), series: [{ key: "Sul", label: "Sul", values: Array(13).fill("1") }] };
  const option = stackedByYear(many, null, TOKENS, { narrow: true, rotate: true, selectedSeries: null });
  const axis = option.yAxis as { type: string; axisLabel: { formatter: (year: string) => string } };
  assert.equal(axis.type, "category");
  assert.equal(axis.axisLabel.formatter("2026"), "2026 (até set)");
});

test("mês sem dado fica com um traço, e não com um número", () => {
  const rows: Row[] = [{ key: "1", label: "jan/26", value: "10" }, { key: "2", label: "fev/26", value: null }];
  const data = monthColumns(rows, "1", TOKENS, false).series[0].data as { label: { formatter?: string }; itemStyle?: { opacity: number } }[];
  assert.equal(data[0].label.formatter, undefined);
  assert.equal(data[1].label.formatter, "—");
  const selected = monthColumns([rows[0], { key: "2", label: "fev/26", value: "5" }], "1", TOKENS, false).series[0].data as { itemStyle: { opacity: number } }[];
  assert.deepEqual(selected.map((d) => d.itemStyle.opacity), [1, 0.4]);
});

test("no celular, o eixo de meses não repete o ano, para doze meses caberem", () => {
  const rows: Row[] = [{ key: "1", label: "jan/25", value: "10" }];
  const axis = (narrow: boolean) => monthColumns(rows, null, TOKENS, narrow).xAxis.axisLabel as { formatter?: (label: string) => string };
  assert.equal(axis(true).formatter!("jan/25"), "jan");
  assert.equal(axis(false).formatter, undefined);
});

const agentData = (over: Partial<AgentContext["data"]>): AgentContext["data"] => ({
  meta: async () => ({ updatedAt: null, warnings: [] }),
  ...over,
}) as AgentContext["data"];

test("o agente respeita o mês da tela e diz o período", async () => {
  const seen: Filters[] = [];
  const ctx: AgentContext = {
    filters: { ...NO_FILTERS, year: 2026, month: 9 },
    scope: SCOPE,
    data: agentData({
      byRegion: (async (filters: Filters) => {
        seen.push(filters);
        return { rows: [], total: null };
      }) as never,
    }),
  };
  const result = await TOOLS.find((t) => t.name === "por_regiao")!.run({}, ctx);
  assert.equal(seen[0].month, 9);
  assert.equal(result.source.period, "set/26");
});

test("a evolução por ano do agente ignora o mês, como o gráfico", async () => {
  let asked: Filters | undefined;
  const ctx: AgentContext = {
    filters: { ...NO_FILTERS, year: 2026, month: 9 },
    scope: SCOPE,
    data: agentData({
      byYear: (async (filters: Filters) => {
        asked = filters;
        return { categories: ["2025", "2026"], series: [], totals: ["1", "2"] };
      }) as never,
    }),
  };
  await TOOLS.find((t) => t.name === "por_ano")!.run({}, ctx);
  assert.equal(asked?.year, null);
  assert.equal(asked?.month ?? null, null);
});

test("o resumo do agente diz os meses do ano incompleto", async () => {
  const ctx: AgentContext = {
    filters: { ...NO_FILTERS, year: 2026, month: null },
    scope: SCOPE,
    data: agentData({
      summary: (async () => ({
        value: "10", quantity: null, quantityUnit: null, area: null, crops: 1, firstYear: 2026, lastYear: 2026, previousValue: null, valueVariation: null,
        addedCrops: 0, addedValue: null, removedCrops: 0, listChanged: false, firstPeriod: "2026-01", lastPeriod: "2026-09", monthsCurrent: 9, monthsPrevious: 0,
      })) as never,
    }),
  };
  const result = await TOOLS.find((t) => t.name === "resumo")!.run({}, ctx);
  assert.equal(result.source.period, "2026, jan a set");
  assert.equal(result.rows[0].area, "só com um mês escolhido");
});

// Leitura do CSV da prova, com poucas linhas escritas à mão.
const encode = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
const CSV = "Ano;Mês;UF;IPI;COFINS\n"
  + "2000;Janeiro;AC;231;\n"
  + "2001;Março;AC;28,53;1,425,403\n"
  + "2024;Setembro;SP;1234,56;226.708.856,85\n";

test("o CSV da prova lê cada formato de número", () => {
  assert.equal(parseValue("28,53", 2001), "28530");
  assert.equal(parseValue("1,425,403", 2002), "1425403");
  assert.equal(parseValue("1234,56", 2024), "1234.56");
  assert.equal(parseValue("226.708.856,85", 2024), "226708856.85");
  assert.equal(parseValue("91.155.798", 2024), "91155798");
  assert.equal(parseValue("-59,57", 2024), "-59.57");
  assert.throws(() => parseValue("12a", 2024));
  assert.throws(() => parseValue("1.2", 2001));
});

test("o CSV da prova não transforma célula vazia em zero, e a soma é exata", () => {
  const cells = parseMonthlyCsv(encode(CSV));
  assert.equal(cells.length, 5);
  assert.deepEqual(cells[0], { year: 2000, month: 1, state: "12", cropCode: "3", cropName: "IPI", value: "231" });
  const totals = totalsBy(cells, (c) => `${c.year}-${c.month}`);
  assert.equal(fromScaled(totals.get("2001-3")!), "1453933");
  assert.equal(fromScaled(totals.get("2024-9")!), "226710091.41");
  assert.equal(fromScaled(toScaled("-0.05") + toScaled("0.02")), "-0.03");
});

test("o CSV da prova recusa o que não reconhece", () => {
  assert.throws(() => parseMonthlyCsv(encode("Ano;Mes;UF;IPI\n2000;Janeiro;AC;1\n")), /cabeçalho/);
  assert.throws(() => parseMonthlyCsv(encode("Ano;Mês;UF;IPI\n2000;Janeiro;XX;1\n")), /inválidos/);
  assert.throws(() => parseMonthlyCsv(encode("Ano;Mês;UF;IPI\n2000;Janeiro;AC;1\n2000;Janeiro;AC;2\n")), /repetida/);
  assert.throws(() => parseMonthlyCsv(encode("Ano;Mês;UF;IPI\n2000;Janeiro;AC\n")), /colunas/);
});
