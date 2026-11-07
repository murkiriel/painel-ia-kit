import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareLoad } from "../load/prepare.ts";
import { ALL_STATES } from "../domain/filters.ts";
import type { SidraRow } from "../load/sidra.ts";

const HEADER = {} as SidraRow;

const row = (state: string, crop: string, cropName: string, year: number, value: string): SidraRow => ({
  D1C: state, D1N: `UF ${state}`, D2C: "215", D2N: "Valor", D3N: String(year), D4C: crop, D4N: cropName, MN: "Mil Reais", V: value,
});

/** Fonte simulada: dez anos, 27 UFs, uma lavoura e o total. Cada teste estraga uma parte. */
function source(change: { metadata?: unknown; year?: (year: number, rows: SidraRow[]) => SidraRow[]; national?: (rows: SidraRow[]) => SidraRow[] } = {}) {
  return async (url: string): Promise<unknown> => {
    if (url.includes("metadados")) return change.metadata ?? { periodicidade: { fim: 2025 } };
    const year = Number(/\/p\/(\d+)\//.exec(url)![1]);
    if (url.includes("/n1/")) {
      const rows = [row("1", "0", "Total", year, "2700"), row("1", "1", "Soja", year, "2700")];
      return [HEADER, ...(change.national ? change.national(rows) : rows)];
    }
    const rows = ALL_STATES.flatMap((state) => [row(state, "0", "Total", year, "100"), row(state, "1", "Soja", year, "100")]);
    return [HEADER, ...(change.year ? change.year(year, rows) : rows)];
  };
}

test("fonte correta passa, e o dado fica pronto para gravar", async () => {
  const prepared = await prepareLoad(source());
  assert.equal(prepared.production.length, 270);
  assert.equal(prepared.national.length, 20);
});

test("sem o último ano nos metadados, nada é gravado", async () => {
  await assert.rejects(prepareLoad(source({ metadata: {} })), /último ano/);
  await assert.rejects(prepareLoad(source({ metadata: { periodicidade: { fim: "x" } } })), /último ano/);
});

test("ano sem linhas é falha, não o fim dos dados", async () => {
  await assert.rejects(prepareLoad(source({ year: (year, rows) => (year === 2020 ? [] : rows) })), /não devolveu linhas para 2020/);
});

test("faltar uma UF interrompe a carga", async () => {
  await assert.rejects(prepareLoad(source({ year: (_, rows) => rows.filter((r) => r.D1C !== "51") })), /Esperava 27 UFs/);
});

test("soma que não fecha com o total interrompe a carga", async () => {
  const wrong = source({ year: (year, rows) => (year === 2022 ? rows.map((r) => (r.D4C === "1" && r.D1C === "51" ? { ...r, V: "500" } : r)) : rows) });
  await assert.rejects(prepareLoad(wrong), /soma não fecha/);
});

test("linha repetida interrompe a carga", async () => {
  await assert.rejects(prepareLoad(source({ year: (_, rows) => [...rows, rows[1]] })), /Linha repetida/);
});

test("falha no meio da leitura não devolve dado parcial", async () => {
  const failing = source();
  let calls = 0;
  const down = async (url: string) => {
    if (++calls === 6) throw new Error("HTTP 500");
    return failing(url);
  };
  await assert.rejects(prepareLoad(down), /HTTP 500/);
});

test("valor não previsto interrompe a carga", async () => {
  const strange = source({ year: (year, rows) => (year === 2021 ? rows.map((r, i) => (i === 1 ? { ...r, V: "X" } : r)) : rows) });
  await assert.rejects(prepareLoad(strange));
});

test("total do Brasil só com a linha de total não fecha", async () => {
  await assert.rejects(prepareLoad(source({ national: (rows) => rows.slice(0, 1) })), /fora do total do Brasil/);
});

test("valor que não fecha com o total do Brasil interrompe a carga", async () => {
  const wrong = source({ national: (rows) => rows.map((r) => (r.D4C === "0" ? { ...r, V: "9000" } : r)) });
  await assert.rejects(prepareLoad(wrong), /valor difere/);
});

test("sem o total do Brasil, a carga não segue", async () => {
  await assert.rejects(prepareLoad(source({ national: () => [] })), /total do Brasil/);
});
