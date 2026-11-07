import assert from "node:assert/strict";
import { test } from "node:test";
import { chartValue, date, dateTime, decimal, EMPTY, money, moneyCompact, month, percent, points, quantity, variation } from "./format.ts";

test("decimal usa o padrão brasileiro", () => {
  assert.equal(decimal(1234.56, 2), "1.234,56");
  assert.equal(decimal("1234.5", 2), "1.234,50");
  assert.equal(decimal(0, 2), "0,00");
});

test("sem dado nunca vira zero", () => {
  for (const value of [null, undefined, "", "abc"]) {
    assert.equal(decimal(value), EMPTY);
    assert.equal(money(value), EMPTY);
    assert.equal(moneyCompact(value), EMPTY);
    assert.equal(percent(value), EMPTY);
    assert.equal(quantity(value, "kg"), EMPTY);
  }
  assert.equal(date(null), EMPTY);
  assert.equal(month(null), EMPTY);
  assert.equal(dateTime(null), EMPTY);
});

test("gráfico não desenha zero onde não há dado", () => {
  assert.equal(chartValue(null), null);
  assert.equal(chartValue(""), null);
  assert.equal(chartValue("   "), null);
  assert.equal(chartValue("abc"), null);
  assert.equal(chartValue("0"), 0);
  assert.equal(chartValue("1234.5"), 1234.5);
});

test("texto só com espaços é sem dado", () => {
  assert.equal(money("   "), EMPTY);
});

test("negativo arredondado para zero não mostra sinal", () => {
  assert.equal(money(-0.4), "R$ 0");
  assert.equal(decimal(-0.04, 1), "0,0");
  assert.equal(percent(-0.0001), "0,0%");
});

test("data fora do formato fica como veio, sem derrubar a tela", () => {
  assert.equal(date("31/10/2026"), "31/10/2026");
  assert.equal(month("31/10/2026"), "31/10/2026");
  assert.equal(dateTime("ontem"), "ontem");
});

test("R$ sem centavos por padrão e unitário com casas fixas", () => {
  assert.equal(money(1234567.89), "R$ 1.234.568");
  assert.equal(money(12.3456, 4), "R$ 12,3456");
  assert.equal(money(-950), "-R$ 950");
});

test("decimal em texto não perde precisão", () => {
  assert.equal(money("9007199254740993.50", 2), "R$ 9.007.199.254.740.993,50");
});

test("unidade fica junto do número", () => {
  assert.equal(quantity(90280, "kg"), "90.280 kg");
});

test("percentual, variação e pontos percentuais são distintos", () => {
  assert.equal(percent(0.256), "25,6%");
  assert.equal(variation(0.125), "+12,5%");
  assert.equal(variation(-0.125), "-12,5%");
  assert.equal(variation(0), "0,0%");
  assert.equal(points(1.5), "+1,5 p.p.");
  assert.equal(points(-0.4), "-0,4 p.p.");
});

test("valor resumido usa 2 casas em M, B e T, e nenhuma em K", () => {
  assert.equal(moneyCompact(5910839111000), "R$ 5,91 T");
  assert.equal(moneyCompact("928003303000.00"), "R$ 928,00 B");
  assert.equal(moneyCompact(950), "R$ 950");
  assert.equal(moneyCompact(0), "R$ 0");
  assert.equal(moneyCompact(604320), "R$ 604 K");
  assert.equal(moneyCompact(1499), "R$ 1 K");
  assert.equal(moneyCompact(-604320), "-R$ 604 K");
  assert.equal(moneyCompact(3400000), "R$ 3,40 M");
  assert.equal(moneyCompact(1250000000), "R$ 1,25 B");
  assert.equal(moneyCompact(-3400000), "-R$ 3,40 M");
});

test("compacto sobe de escala no arredondamento", () => {
  assert.equal(moneyCompact(999.99), "R$ 1 K");
  assert.equal(moneyCompact(999499), "R$ 999 K");
  assert.equal(moneyCompact(999500), "R$ 1,00 M");
  assert.equal(moneyCompact(999999), "R$ 1,00 M");
  assert.equal(moneyCompact(-999999), "-R$ 1,00 M");
  assert.equal(moneyCompact(999999999), "R$ 1,00 B");
  assert.equal(moneyCompact(999999999999), "R$ 1,00 T");
});

test("datas não mudam de dia por causa do fuso", () => {
  assert.equal(date("2026-10-31"), "31/10/2026");
  assert.equal(date("2026-01-01"), "01/01/2026");
});

test("mês do eixo sai como out/26", () => {
  assert.equal(month("2026-10"), "out/26");
  assert.equal(month("2026-10-31"), "out/26");
  assert.equal(month("2027-01"), "jan/27");
});

test("instante usa o fuso de quem lê", () => {
  assert.equal(dateTime("2026-10-31T23:00:00Z", "America/Sao_Paulo"), "31/10/2026 20:00");
});
