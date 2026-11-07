import assert from "node:assert/strict";
import { test } from "node:test";
import { activeSelections, clearFilters, detailQuery, hasFilters, normalizeSearch, panelQuery, selectedValue, setFilter, toggleSelection } from "./filters.ts";

const read = (query: string) => Object.fromEntries(new URLSearchParams(query));

test("filtro global vale para todos os blocos", () => {
  const search = setFilter("", "ano", "2026");
  assert.deepEqual(read(panelQuery(search, "a")), { ano: "2026" });
  assert.deepEqual(read(panelQuery(search, "b")), { ano: "2026" });
});

test("o gráfico clicado não filtra a si mesmo", () => {
  const search = toggleSelection("ano=2026", "por_regiao", "regiao", "Sul");
  assert.deepEqual(read(panelQuery(search, "por_regiao")), { ano: "2026" });
  assert.deepEqual(read(panelQuery(search, "por_produto")), { ano: "2026", regiao: "Sul" });
});

test("o detalhe usa todas as seleções", () => {
  const search = toggleSelection("", "por_regiao", "regiao", "Sul");
  assert.deepEqual(read(panelQuery(search, null)), { regiao: "Sul" });
});

test("clicar de novo limpa, e outro item troca", () => {
  const first = toggleSelection("", "a", "regiao", "Sul");
  assert.equal(selectedValue(first, "a"), "Sul");
  assert.equal(selectedValue(toggleSelection(first, "a", "regiao", "Norte"), "a"), "Norte");
  assert.equal(selectedValue(toggleSelection(first, "a", "regiao", "Sul"), "a"), null);
});

test("valor com caracteres especiais sobrevive", () => {
  for (const value of ["A:B", "Pão & Cia", "São Paulo", "50%", "a=b"]) {
    const search = toggleSelection("", "a", "cliente", value);
    assert.equal(selectedValue(search, "a"), value);
    assert.equal(read(panelQuery(search, "b")).cliente, value);
  }
});

test("estado de navegação não vira filtro", () => {
  assert.deepEqual(read(panelQuery("ano=2026&tela=conferencia&por=produto&pagina=2", "b")), { ano: "2026" });
});

test("o detalhe recebe a dimensão e a página", () => {
  const search = toggleSelection("ano=2026&por=produto", "a", "regiao", "Sul") + "&pagina=2";
  assert.deepEqual(read(detailQuery(search)), { ano: "2026", regiao: "Sul", por: "produto", pagina: "2" });
});

test("mudar um filtro volta para a primeira página", () => {
  assert.equal(read(setFilter("pagina=7", "ano", "2026")).pagina, undefined);
  assert.equal(read(toggleSelection("pagina=7", "a", "regiao", "Sul")).pagina, undefined);
});

test("na mesma dimensão, a seleção vale sobre o filtro global", () => {
  const search = toggleSelection("regiao=Norte", "a", "regiao", "Sul");
  assert.equal(read(panelQuery(search, "b")).regiao, "Sul");
  assert.equal(read(panelQuery(search, "a")).regiao, "Norte");
});

test("entre seleções da mesma dimensão, vale a mais nova", () => {
  let search = toggleSelection("", "a", "regiao", "Sul");
  search = toggleSelection(search, "b", "regiao", "Norte");
  assert.equal(read(panelQuery(search, "c")).regiao, "Norte");
  search = toggleSelection(search, "a", "regiao", "Leste");
  assert.equal(read(panelQuery(search, "c")).regiao, "Leste");
});

test("a mesma seleção gera sempre o mesmo texto de consulta", () => {
  assert.equal(panelQuery("b=2&a=1", "x"), panelQuery("a=1&b=2", "x"));
});

test("filtro repetido chega ao backend, para ser recusado", () => {
  assert.equal(panelQuery("uf=51&uf=35", "a"), "uf=51&uf=35");
});

test("no seletor, a última ação vale: o clique na mesma dimensão sai", () => {
  const search = toggleSelection("", "a", "uf", "51");
  assert.equal(read(panelQuery(setFilter(search, "uf", "35"), "b")).uf, "35");
  assert.deepEqual(activeSelections(setFilter(search, "uf", "35")), []);
});

test("escolher no seletor retira o clique em dimensão ligada", () => {
  const search = toggleSelection("", "a", "uf", "51");
  assert.deepEqual(activeSelections(setFilter(search, "regiao", "Sul", ["uf"])), []);
  assert.equal(activeSelections(setFilter(search, "ano", "2024")).length, 1);
});

test("limpar mantém o agrupamento e a ordem, e tira só os filtros", () => {
  const search = "ano=2024&por=uf&pagina=3&ordem=area&dir=asc&sel.a=uf:51";
  assert.deepEqual(read(clearFilters(search)), { por: "uf", ordem: "area", dir: "asc" });
  assert.equal(hasFilters("por=uf&pagina=2"), false);
  assert.equal(hasFilters("por=uf&ano=2024"), true);
  assert.equal(hasFilters("sel.a=uf:51"), true);
});

test("seleção malformada no link é ignorada", () => {
  assert.deepEqual(activeSelections("sel.x=semdois"), []);
  assert.equal(panelQuery("sel.x=semdois", "b"), "");
});

test("a ordem da tabela chega ao detalhe, sem filtrar os outros blocos", () => {
  assert.deepEqual(read(detailQuery("ordem=area&dir=asc")), { ordem: "area", dir: "asc" });
  assert.equal(panelQuery("ordem=area&dir=asc", "a"), "");
});

test("link antigo: seletor e clique não disputam a mesma dimensão", () => {
  assert.deepEqual(read(normalizeSearch("sel.a=uf:51&uf=35") ?? ""), { "sel.a": "uf:51" });
  assert.deepEqual(read(normalizeSearch("sel.anos=ano:2020") ?? ""), { ano: "2020" });
  assert.equal(normalizeSearch("sel.a=uf:51&regiao=Sul"), null);
  assert.equal(normalizeSearch("ano=2024"), null);
});

test("lista as seleções ativas", () => {
  const search = toggleSelection("ano=2026", "a", "cliente", "A:B");
  assert.deepEqual(activeSelections(search), [{ panel: "a", dimension: "cliente", value: "A:B" }]);
});

test("clique em outro gráfico na mesma dimensão retira a seleção anterior", () => {
  const search = toggleSelection(toggleSelection("", "anos", "regiao", "Sul"), "regioes", "regiao", "Norte");
  assert.deepEqual(activeSelections(search), [{ panel: "regioes", dimension: "regiao", value: "Norte" }]);
  assert.equal(toggleSelection(toggleSelection("", "anos", "regiao", "Sul"), "anos", "regiao", "Sul"), "");
});
