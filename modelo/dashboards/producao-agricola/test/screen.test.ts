// As regras da tela, sem navegador, e a fiação dos componentes a elas. O que depende de pixel fica na verificação no navegador.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { coveredPeriod, periodText } from "../../../shared/format.ts";
import { anchorStep } from "../../../web/src/components/clickAnchor.ts";
import { regionDonut } from "../web/charts.ts";
import { blockedControls, chooseYearQuery, correctedLink, detailControls, detailTitle, outOfPermission, screenQueries, totalLabel } from "../web/screenRules.ts";

// Caminhos a partir da raiz do projeto: a tela tem peças do dashboard e peças comuns do portal.
import { failureAction } from "../../../web/src/panelRules.ts";

const source = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("consultas: o mapa e as barras não filtram a si mesmos, e o detalhe usa todas as seleções", () => {
  const queries = screenQueries("ano=2024&sel.mapa=uf%3A41&sel.estados=uf%3A35", false);
  assert.equal(queries.map, "ano=2024&uf=35");
  assert.equal(queries.states, "ano=2024&uf=41");
  assert.equal(queries.detail, "ano=2024&uf=35");
  assert.equal(queries.summary, queries.options);
  // Sozinha, a seleção do mapa filtra as barras, e não o mapa.
  assert.equal(screenQueries("sel.mapa=uf%3A41", false).map, "");
  assert.equal(screenQueries("sel.mapa=uf%3A41", false).states, "uf=41");
  assert.equal(screenQueries("sel.estados=uf%3A41", false).states, "");
  assert.equal(screenQueries("sel.estados=uf%3A41", false).map, "uf=41");
  assert.equal(screenQueries("sel.regioes=regiao%3ASul", false).regions, "");
  assert.equal(screenQueries("sel.lavouras=lavoura%3A1", false).crops, "");
  assert.equal(screenQueries("sel.anos=regiao%3ASul", false).years, "ano=todos");
});

test("consultas: o gráfico por ano mostra todos os anos e não fica preso ao mês", () => {
  assert.equal(screenQueries("ano=2024&mes=3&uf=41", true).years, "ano=todos&uf=41");
  assert.equal(screenQueries("ano=2024", false).years, "ano=todos");
  // Com o mês desligado, "mes" chega ao backend, que recusa: nada some em silêncio.
  assert.match(screenQueries("ano=2024&mes=3", false).years, /mes=3/);
});

test("controles: só o site estático desliga, e pela regra do que foi publicado", () => {
  assert.deepEqual(blockedControls("lavoura=1", false), { uf: false, lavoura: false });
  assert.deepEqual(blockedControls("lavoura=1", true), { uf: true, lavoura: false });
  assert.deepEqual(blockedControls("sel.mapa=uf%3A41", true), { uf: false, lavoura: true });
});

test("link: a disputa entre clique e seletor sempre se resolve, e a ordem não publicada só volta no site estático", () => {
  assert.equal(correctedLink("uf=41&sel.mapa=uf%3A35", false), "sel.mapa=uf%3A35");
  assert.equal(correctedLink("ordem=area&dir=asc&pagina=2", false), null);
  assert.equal(correctedLink("ordem=area&dir=asc&pagina=2", true), "ordem=area&dir=asc");
  assert.equal(correctedLink("lavoura=1&regiao=Sul&ordem=area&dir=asc", true), "lavoura=1&regiao=Sul");
  assert.equal(correctedLink("ano=2024", true), null);
});

test("trocar o ano: o mês só continua se existir no ano novo", () => {
  const months = { 2024: [1, 2, 3], 2025: [1] };
  assert.equal(chooseYearQuery("ano=2024&mes=3", "2025", true, months), "ano=2025");
  assert.equal(chooseYearQuery("ano=2025&mes=1", "2024", true, months), "ano=2024&mes=1");
  assert.equal(chooseYearQuery("ano=2024&mes=3", null, true, months), "");
  assert.equal(chooseYearQuery("ano=2024&mes=3", "todos", true, months), "ano=todos");
  assert.equal(chooseYearQuery("ano=2024&pagina=3", "2025", false, undefined), "ano=2025");
});

test("tabela: linha agrupada que levaria a um recorte não publicado não filtra, só no site estático", () => {
  const site = { hasMonth: false, staticSite: true };
  const server = { hasMonth: false, staticSite: false };
  assert.equal(detailControls("por=uf&lavoura=1", 5, site).blockedByRow, true);
  assert.equal(detailControls("por=lavoura&uf=41", 5, site).blockedByRow, true);
  assert.equal(detailControls("por=uf", 5, site).blockedByRow, false);
  assert.equal(detailControls("por=regiao&lavoura=1", 5, site).blockedByRow, false);
  assert.equal(detailControls("por=uf&lavoura=1", 5, server).blockedByRow, false);
});

test("tabela: só ordena a coluna que mostra número, e o site estático só onde há arquivo", () => {
  const site = { hasMonth: false, staticSite: true };
  const server = { hasMonth: false, staticSite: false };
  assert.deepEqual(detailControls("por=uf", 5, server).sortable, ["nome", "valor", "area"]);
  assert.deepEqual(detailControls("por=uf&ano=todos", 5, server).sortable, ["nome", "valor"]);
  assert.deepEqual(detailControls("por=lavoura", 5, server).sortable, ["nome", "valor", "quantidade", "area"]);
  assert.deepEqual(detailControls("", 5, server).sortable, ["ano", "uf", "regiao", "lavoura", "valor", "quantidade", "area"]);
  assert.deepEqual(detailControls("", 5, { hasMonth: true, staticSite: false }).sortable, ["mes", "uf", "regiao", "lavoura", "valor", "quantidade", "area"]);
  assert.deepEqual(detailControls("por=uf", 1, site).sortable, [], "uma linha não tem outra ordem");
  assert.deepEqual(detailControls("por=uf", 1, server).sortable, ["nome", "valor", "area"]);
  assert.deepEqual(detailControls("lavoura=1&regiao=Sul", 9, site).sortable, [], "lavoura e região: só a ordem por valor foi publicada");
  assert.equal(detailControls("ordem=area&dir=asc", 9, site).otherOrder, true);
});

test("título do detalhe: diz o intervalo que a tabela soma, com acumulado, e não o período dos filtros", () => {
  const place = ["Brasil"];
  assert.equal(detailTitle({ firstYear: 2016, lastYear: 2025 }, "2025 · Brasil", place), "Detalhe · acumulado de 2016 a 2025 · Brasil");
  assert.equal(detailTitle({ firstYear: 2025, lastYear: 2025 }, "2025 · Brasil", place), "Detalhe · 2025 · Brasil");
  assert.equal(detailTitle({ firstPeriod: "2000-01", lastPeriod: "2026-09", firstYear: 2000, lastYear: 2026, monthsCovered: 321 }, "2026 · Brasil", place), "Detalhe · acumulado de jan/00 a set/26 · Brasil");
  assert.equal(detailTitle({ firstPeriod: "2017-01", lastPeriod: "2017-12", firstYear: 2017, lastYear: 2017, monthsCovered: 10 }, "x", ["Paraná", "Soja"]), "Detalhe · 2017, 10 meses · Paraná · Soja");
  // Sem dado ou antes de chegar, fica o período dos filtros.
  assert.equal(detailTitle({ firstYear: null, lastYear: null }, "2025 · Brasil", place), "Detalhe · 2025 · Brasil");
  assert.equal(detailTitle(undefined, "2025 · Brasil", place), "Detalhe · 2025 · Brasil");
});

test("linha de total: diz quando é acumulado, com o intervalo", () => {
  assert.equal(totalLabel({ firstYear: 2016, lastYear: 2025 }), "Total acumulado de 2016 a 2025");
  assert.equal(totalLabel({ firstYear: 2025, lastYear: 2025 }), "Total");
  assert.equal(totalLabel({ firstPeriod: "2000-01", lastPeriod: "2026-09", monthsCovered: 321 }), "Total acumulado de jan/00 a set/26");
  assert.equal(totalLabel({ firstPeriod: "2017-01", lastPeriod: "2017-12", monthsCovered: 10 }), "Total");
  assert.equal(totalLabel({ firstYear: null, lastYear: null }), "Total");
  assert.equal(totalLabel(undefined), "Total");
});

test("período: com meses faltando no meio, diz quantos, como o eixo do gráfico de anos", () => {
  assert.equal(periodText("2017-01", "2017-12", 10), "2017, 10 meses");
  assert.equal(periodText("2017-01", "2017-12", 12), "2017");
  assert.equal(periodText("2026-01", "2026-09", 9), "2026, jan a set");
  assert.equal(periodText("2026-01", "2026-09", 7), "2026, 7 meses");
  assert.equal(periodText("2026-08", "2026-10", 3), "2026, ago a out");
  assert.equal(periodText("2026-03", "2026-03", 1), "mar/26");
  assert.equal(periodText("2000-01", "2026-09", 321), "acumulado de jan/00 a set/26");
  // Sem o número de meses, com o mês desligado, nada muda.
  assert.equal(periodText("2017-01", "2017-12"), "2017");
  assert.equal(coveredPeriod({ firstYear: 2024, lastYear: 2024 }), "2024");
  assert.equal(coveredPeriod({ firstPeriod: "2017-01", lastPeriod: "2017-12", monthsCovered: 10 }), "2017, 10 meses");
});

test("permissão: UF ou região fora da lista de quem vê, inclusive por clique. Dentro dela, ou sem filtro, não", () => {
  const labels = { uf: { 53: "Distrito Federal" }, regiao: { "Centro-Oeste": "Centro-Oeste" } };
  assert.equal(outOfPermission("uf=41", labels), true);
  assert.equal(outOfPermission("sel.mapa=uf%3A41", labels), true);
  assert.equal(outOfPermission("regiao=Sul", labels), true);
  assert.equal(outOfPermission("sel.regioes=regiao%3ASul", labels), true);
  assert.equal(outOfPermission("uf=53", labels), false);
  assert.equal(outOfPermission("regiao=Centro-Oeste", labels), false);
  assert.equal(outOfPermission("ano=2025", labels), false);
  assert.equal(outOfPermission("uf=constructor", labels), true, "nome de propriedade do JavaScript não passa por UF");
});

test("falha: tentar de novo só aparece quando pode resolver", () => {
  assert.equal(failureAction({ invalidLink: false }), "retry");
  assert.equal(failureAction({ invalidLink: false, forbidden: true }), "home");
  assert.equal(failureAction({ invalidLink: true }), "home");
  assert.equal(failureAction({ invalidLink: false, unpublished: true }), "home");
});

test("clique: o item que subiu faz a página rolar para cima, e o que desceu, para baixo", () => {
  assert.deepEqual(anchorStep(-32, 500, 0), { scrollY: 468, room: 0 });
  assert.deepEqual(anchorStep(32, 500, 0), { scrollY: 532, room: 0 });
});

test("clique: no topo da página, sem para onde rolar, reserva espaço, e devolve antes de rolar", () => {
  assert.deepEqual(anchorStep(-32, 0, 0), { scrollY: 0, room: 32 });
  assert.deepEqual(anchorStep(-32, 10, 0), { scrollY: 0, room: 22 });
  assert.deepEqual(anchorStep(20, 0, 32), { scrollY: 0, room: 12 });
  assert.deepEqual(anchorStep(40, 0, 32), { scrollY: 8, room: 0 });
  // O efeito soma sempre o que o item saiu do lugar.
  for (const [moved, y, room] of [[-50, 20, 5], [50, 20, 5], [7, 0, 0], [-7, 7, 0]]) {
    const next = anchorStep(moved, y, room);
    assert.equal((y - next.scrollY) + (next.room - room), -moved, `${moved} ${y} ${room}`);
    assert.ok(next.scrollY >= 0 && next.room >= 0);
  }
});

test("fiação: a tela usa as mesmas regras que os testes provam", () => {
  const wiring: [string, string[]][] = [
    ["dashboards/producao-agricola/web/Dashboard.tsx", [
      "screenQueries(search, hasMonth)",
      'usePanel<ByYear>("by-year", queries.years)',
      'usePanel<Rows>("by-state", queries.map)',
      'usePanel<Rows>("by-state", queries.states)',
      "blockedControls(search, __STATIC_SITE__)",
      "correctedLink(search, __STATIC_SITE__)",
      "chooseYearQuery(window.location.search, value, hasMonth, optionData?.monthsByYear)",
      "disabled={blocked.uf}",
      "disabled={blocked.lavoura}",
      'blocked.uf ? undefined : select("mapa", "uf")',
      'blocked.uf ? undefined : select("estados", "uf")',
      'blocked.lavoura ? undefined : select("lavouras", "lavoura")',
      "holdClickedPlace(event.currentTarget, event.target as Element)",
      "outOfPermission(search, optionData.labels)",
      "periodText(summaryData.firstPeriod, summaryData.lastPeriod, summaryData.monthsCovered)",
      // No título, sem o nome, nada: nunca o código.
      "optionData?.labels[dimension][key] ?? null",
    ]],
    ["dashboards/producao-agricola/web/DetailTable.tsx", [
      "detailControls(search, shown?.count, { hasMonth, staticSite: __STATIC_SITE__ })",
      "detailTitle(shown?.totals, scope, place)",
      '[by ? "label" : "state_name"]: totalText',
      "if (!by || blockedByRow || e.node.rowPinned",
    ]],
    ["web/src/components/MapCanvas.tsx", [
      "onClick={() => onSelect?.(item.key)}",
      "clickableKey(keyAt(event.point), latest.current.byKey)",
      "legendEntries(scale, format, missing)",
      "tokens.primary, tokens.surface, tokens.negative",
    ]],
    ["web/src/components/Chart.tsx", ['dispatchAction({ type: "hideTip" })']],
    ["web/src/components/Block.tsx", ["failureAction(state)"]],
  ];
  for (const [file, pieces] of wiring) {
    const text = source(file);
    for (const piece of pieces) assert.ok(text.includes(piece), `${file}: falta ${piece}`);
  }
  assert.doesNotMatch(source("dashboards/producao-agricola/web/Dashboard.tsx"), /blockedFilters|fixSiteLink|normalizeSearch/);
});

test("legenda do mapa: é uma escala de cores, sem botão nem cursor de clique", () => {
  const map = source("web/src/components/MapCanvas.tsx");
  const legend = map.slice(map.indexOf('className="map-legend"'), map.indexOf("<small>{caption}"));
  assert.doesNotMatch(legend, /<button|onClick|cursor/);
  for (const rule of source("web/src/theme.css").match(/\.map-legend[^{]*\{[^}]*\}/g) ?? []) assert.doesNotMatch(rule, /cursor:\s*pointer/, rule);
});

test("clique: nada na tela muda de largura ao selecionar, e o navegador não soma o ajuste dele", () => {
  const css = source("web/src/theme.css");
  assert.match(css, /html \{ overflow-anchor: none; \}/);
  assert.match(css, /\.page \{[^}]*align-content: start/);
  assert.doesNotMatch(css.match(/\.chart-legend button\[aria-pressed="true"\] \{[^}]*\}/)![0], /font-weight/);
});

test("clique: o donut atualiza as fatias, em vez de refazê-las do zero a cada clique", () => {
  const tokens = { primary: "#000000", negative: "#000000", text: "#000000", muted: "#000000", grid: "#000000", surface: "#000000", background: "#000000", series: ["#000000"] };
  const series = regionDonut([{ key: "Sul", label: "Sul", value: "1" }], "1", null, tokens, false).series[0];
  assert.equal(series.id, "regioes");
});

test("estilo: a barra lateral não cobre a última linha no toque, e o \"?\" não cobre o número", () => {
  const css = source("web/src/theme.css");
  assert.match(css, /\.ag-body-horizontal-scroll\.ag-scrollbar-invisible \{ position: static; \}/);
  const least = Number(/\.kpis \{[^}]*minmax\((\d+)px/.exec(css)![1]);
  assert.ok(least >= 185, String(least));
});

test("aberto direto do disco: a mensagem está em português, fora do módulo que não carrega", () => {
  const html = source("index.html");
  const inline = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
  assert.match(inline, /location\.protocol === "file:"/);
  assert.match(inline, /não abre direto do disco/);
  assert.ok(html.indexOf('<div id="root">') < html.indexOf("<script>"), "a raiz precisa existir quando o script roda");
  assert.ok(html.indexOf("<script>") < html.indexOf('type="module"'));
});
