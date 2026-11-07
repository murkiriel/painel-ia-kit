import assert from "node:assert/strict";
import { test } from "node:test";
import { grantedScope, hashPassword, passwordMatches, readAuthMode } from "../../../server/auth.ts";
import { ALL_STATES, BadRequest, readDetail, readFilters, SCOPE, usesDefaultYear } from "../domain/filters.ts";

test("parâmetro desconhecido é erro, nunca é ignorado", () => {
  assert.throws(() => readFilters(new URLSearchParams("anoo=2024")), BadRequest);
  assert.throws(() => readFilters(new URLSearchParams("por=uf")), BadRequest);
});

test("filtro repetido é erro, para o segundo valor não ser ignorado", () => {
  assert.throws(() => readFilters(new URLSearchParams("uf=51&uf=35")), BadRequest);
});

test("modo de acesso desconhecido nunca abre o acesso", () => {
  assert.equal(readAuthMode("local"), "local");
  assert.equal(readAuthMode("login"), "login");
  for (const value of ["LOGIN", "Login", "true", "", undefined]) assert.throws(() => readAuthMode(value));
});

test("filtro válido é lido", () => {
  assert.deepEqual(readFilters(new URLSearchParams("ano=2024&uf=51")), { year: 2024, region: null, state: "51", crop: null });
});

test("valor que não existe é erro", () => {
  assert.throws(() => readFilters(new URLSearchParams("regiao=Marte")), BadRequest);
  assert.throws(() => readFilters(new URLSearchParams("uf=99")), BadRequest);
  assert.throws(() => readFilters(new URLSearchParams("lavoura=")), BadRequest);
  assert.throws(() => readFilters(new URLSearchParams("lavoura=abc")), BadRequest);
});

test("todos os anos é uma escolha explícita", () => {
  assert.equal(readFilters(new URLSearchParams("ano=todos")).year, null);
  assert.equal(usesDefaultYear(new URLSearchParams("ano=todos")), false);
  assert.equal(usesDefaultYear(new URLSearchParams("uf=51")), true);
});

test("a ordem vem de lista fechada", () => {
  assert.equal(readDetail(new URLSearchParams("ordem=area&dir=asc")).order, "area_ha ASC NULLS LAST");
  assert.equal(readDetail(new URLSearchParams("por=uf&ordem=nome")).order, "$LABEL DESC NULLS LAST");
  assert.throws(() => readDetail(new URLSearchParams("ordem=password")), BadRequest);
  assert.throws(() => readDetail(new URLSearchParams("ordem=nome")), BadRequest);
  assert.throws(() => readDetail(new URLSearchParams("por=uf&ordem=uf")), BadRequest);
  assert.throws(() => readDetail(new URLSearchParams("dir=1;DROP")), BadRequest);
});

test("ano precisa ser inteiro", () => {
  assert.throws(() => readFilters(new URLSearchParams("ano=1;DROP")), BadRequest);
});

test("dimensão de detalhe vem de lista fechada", () => {
  const detail = readDetail(new URLSearchParams("por=uf&pagina=2"));
  assert.equal(detail.by, "uf");
  assert.equal(detail.page, 2);
  assert.throws(() => readDetail(new URLSearchParams("por=password")), BadRequest);
  assert.throws(() => readDetail(new URLSearchParams("por=constructor")), BadRequest);
  assert.throws(() => readDetail(new URLSearchParams("pagina=0")), BadRequest);
});

test("sem perfil nem lista, a permissão é vazia", () => {
  const dashboard = { scope: SCOPE };
  assert.deepEqual(grantedScope(dashboard, { full: false, codes: [] }), []);
  assert.deepEqual(grantedScope(dashboard, { full: false, codes: ["51"] }), ["51"]);
  assert.deepEqual(grantedScope(dashboard, { full: true, codes: [] }), ALL_STATES);
  assert.equal(grantedScope(dashboard, undefined), null);
});

test("senha confere só com o hash certo", () => {
  const { hash, salt } = hashPassword("segredo-de-teste");
  assert.equal(passwordMatches("segredo-de-teste", hash, salt), true);
  assert.equal(passwordMatches("outra", hash, salt), false);
});
