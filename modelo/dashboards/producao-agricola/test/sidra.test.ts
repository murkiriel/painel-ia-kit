import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanCropName, COFFEE_TOTAL_CROP, parseNational, parseValue, parseYear, reconcile, regionOf, TOTAL_CROP, type SidraRow } from "../load/sidra.ts";

const row = (crop: string, cropName: string, variable: string, unit: string, value: string, state = "51", year = "2024"): SidraRow => ({
  D1C: state, D1N: "Mato Grosso", D2C: variable, D2N: "Variável", D3N: year, D4C: crop, D4N: cropName, MN: unit, V: value,
});
const value = (crop: string, name: string, v: string, state?: string) => row(crop, name, "215", "Mil Reais", v, state);

test("símbolos da fonte não viram zero, exceto o traço", () => {
  assert.deepEqual(parseValue("123"), { kind: "number", text: "123" });
  assert.deepEqual(parseValue("-"), { kind: "number", text: "0" });
  assert.deepEqual(parseValue(".."), { kind: "empty" });
  assert.deepEqual(parseValue("..."), { kind: "empty" });
  assert.deepEqual(parseValue("X"), { kind: "rejected" });
});

test("o total do café não entra na soma, para não contar duas vezes", () => {
  const parsed = parseYear([
    value("40140", "Café (em grão) Arábica", "60"),
    value("40141", "Café (em grão) Canephora", "40"),
    value(COFFEE_TOTAL_CROP, "Café (em grão) Total", "100"),
    value(TOTAL_CROP, "Total", "100"),
  ]);
  assert.deepEqual(parsed.production.map((p) => p.crop_code).sort(), ["40140", "40141"]);
  assert.deepEqual(reconcile(parsed), []);
});

test("o total publicado fica separado da produção", () => {
  const parsed = parseYear([value(TOTAL_CROP, "Total", "100"), value("1", "Soja", "100")]);
  assert.equal(parsed.production.length, 1);
  assert.equal(parsed.totals[0].value_brl, "100000");
});

test("valor em mil reais vira reais sem ponto flutuante", () => {
  const parsed = parseYear([value("1", "Soja", "63847218")]);
  assert.equal(parsed.production[0].value_brl, "63847218000");
});

test("lavoura sem plantio não vira linha, mas dado indisponível não vira zero", () => {
  const parsed = parseYear([
    value("1", "Sem plantio", "-"),
    value("2", "Indisponível", "..."),
    value("3", "Soja", "10"),
    row("3", "Soja", "214", "Toneladas", "..."),
  ]);
  assert.deepEqual(parsed.production.map((p) => p.crop_code), ["3"]);
  assert.equal(parsed.production[0].quantity_t, null);
});

test("unidade inesperada interrompe a carga", () => {
  assert.throws(() => parseYear([row("1", "Soja", "215", "Mil Cruzeiros", "10")]), /Unidade inesperada/);
});

test("valor não previsto é rejeitado e informado", () => {
  const parsed = parseYear([value("1", "Soja", "X")]);
  assert.equal(parsed.rejected.length, 1);
  assert.equal(parsed.production.length, 0);
});

test("a conferência aceita o arredondamento da fonte e reprova o resto", () => {
  const close = parseYear([value("1", "Soja", "101"), value(TOTAL_CROP, "Total", "100")]);
  assert.deepEqual(reconcile(close), []);
  const far = parseYear([value("1", "Soja", "102"), value(TOTAL_CROP, "Total", "100")]);
  assert.equal(reconcile(far).length, 1);
});

test("linha repetida na fonte interrompe a carga", () => {
  assert.throws(() => parseYear([value("1", "Soja", "10"), value("1", "Soja", "10")]), /Linha repetida/);
});

test("lavoura com asterisco fica com a unidade a verificar", () => {
  const parsed = parseYear([value("1", "Abacaxi*", "10"), value("2", "Soja", "10")]);
  assert.equal(parsed.production[0].quantity_unit, "a verificar");
  assert.equal(parsed.production[0].crop_name, "Abacaxi (unidade a verificar)");
  assert.equal(parsed.production[1].quantity_unit, "t");
});

test("total do Brasil guarda os símbolos como vazio", () => {
  const [total] = parseNational([value("0", "Total", "100"), row("0", "Total", "214", "Toneladas", "..")]);
  assert.equal(total.value_brl, "100000");
  assert.equal(total.quantity_t, null);
});

test("região e nome da lavoura", () => {
  assert.equal(regionOf("51"), "Centro-Oeste");
  assert.equal(regionOf("11"), "Norte");
  assert.throws(() => regionOf("99"));
  assert.equal(cleanCropName("Soja (em grão)"), "Soja (em grão)");
});
