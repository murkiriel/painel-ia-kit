// Regras da tela, sem React, para testar sem navegador: Dashboard.tsx, DetailTable.tsx e a prova do site estático usam estas mesmas.
import { detailQuery, normalizeSearch, panelQuery, setFilter } from "../../../shared/filters.ts";
import { coveredPeriod, type Covered } from "../../../shared/format.ts";
import { blockedFilters, fixSiteLink, isOrderLockedAt, isOtherOrder } from "../shared/staticSite.ts";

const ALL_YEARS = "todos";

/** A consulta de cada bloco. Cada um ignora a própria seleção, e o gráfico por ano mostra sempre todos os anos e meses. */
export function screenQueries(search: string, hasMonth: boolean) {
  const years = new URLSearchParams(panelQuery(search, "anos"));
  years.set("ano", ALL_YEARS);
  if (hasMonth) years.delete("mes");
  years.sort();
  return {
    options: panelQuery(search, null),
    summary: panelQuery(search, null),
    years: years.toString(),
    regions: panelQuery(search, "regioes"),
    states: panelQuery(search, "estados"),
    map: panelQuery(search, "mapa"),
    crops: panelQuery(search, "lavouras"),
    detail: detailQuery(search),
  };
}

/** Só no site estático: UF e lavoura não se combinam, e o controle que levaria a isso fica desligado. */
export const blockedControls = (search: string, staticSite: boolean) => (staticSite ? blockedFilters(search) : { uf: false, lavoura: false });

/** O link corrigido, ou null se já está certo. O site estático ainda volta a ordem ou a página que não foram publicadas. */
export function correctedLink(search: string, staticSite: boolean): string | null {
  const normal = normalizeSearch(search);
  const fixed = staticSite ? fixSiteLink(normal ?? search) : null;
  return fixed ?? normal;
}

/** Trocar o ano: o mês só continua se existir no ano novo, porque o mês sempre vai com um ano. */
export function chooseYearQuery(search: string, year: string | null, hasMonth: boolean, monthsByYear: Record<string, number[]> | undefined): string {
  const month = new URLSearchParams(search).get("mes");
  const keepsMonth = !hasMonth || (year !== null && month !== null && monthsByYear?.[year]?.includes(Number(month)));
  return setFilter(keepsMonth ? search : setFilter(search, "mes", null), "ano", year);
}

const GROUP_COLUMNS = ["nome", "valor", "quantidade", "area"];
const LINE_COLUMNS = ["uf", "regiao", "lavoura", "valor", "quantidade", "area"];

/** O que a tabela permite em um endereço. "count" é o total de linhas da resposta. */
export function detailControls(search: string, count: number | undefined, { hasMonth, staticSite }: { hasMonth: boolean; staticSite: boolean }) {
  const params = new URLSearchParams(search);
  const by = params.get("por") ?? "";
  // Só ordena a coluna que aparece: "—" em todas as linhas pareceria ordem aleatória.
  const showsQuantity = !by || by === "lavoura" || new URLSearchParams(panelQuery(search, null)).has("lavoura");
  const showsArea = !by || (hasMonth ? by === "mes" || params.has("mes") : by === "ano" || params.get("ano") !== ALL_YEARS);
  // Só no site estático: sem arquivo para aquela ordem, o cabeçalho não ordena, e a seta continua dizendo qual vale.
  const cutOrder = staticSite && isOrderLockedAt(search);
  const orderLocked = staticSite && (cutOrder || (count !== undefined && count <= 1));
  const otherOrder = staticSite && isOtherOrder(search);
  // A linha agrupada vira filtro: no site estático, só se o resultado foi publicado.
  const blockedByRow = staticSite && (by === "uf" || by === "lavoura") && blockedFilters(search)[by];
  const columns = by ? GROUP_COLUMNS : [hasMonth ? "mes" : "ano", ...LINE_COLUMNS];
  const sortable = orderLocked ? [] : columns.filter((name) => (name !== "quantidade" || showsQuantity) && (name !== "area" || showsArea));
  return { showsQuantity, showsArea, cutOrder, orderLocked, otherOrder, blockedByRow, sortable };
}

/** O título do detalhe diz o que a tabela soma, que nem sempre é o período dos filtros: "Por ano", sem ano escolhido, mostra todos. */
export function detailTitle(totals: Covered | undefined, scope: string, place: string[]): string {
  const period = totals ? coveredPeriod(totals) : null;
  return `Detalhe · ${period === null ? scope : [period, ...place].join(" · ")}`;
}

/** A linha de total diz quando é um acumulado, com o intervalo. */
export function totalLabel(totals: Covered | undefined): string {
  const period = totals ? coveredPeriod(totals) : null;
  return period?.startsWith("acumulado") ? `Total ${period}` : "Total";
}

/** UF ou região do link que não existem para quem vê. A resposta é a mesma de um recorte vazio: não diz se há dado lá. */
export function outOfPermission(search: string, labels: { uf: Record<string, string>; regiao: Record<string, string> }): boolean {
  const query = new URLSearchParams(panelQuery(search, null));
  const state = query.get("uf");
  const region = query.get("regiao");
  return (state !== null && !Object.hasOwn(labels.uf, state)) || (region !== null && !Object.hasOwn(labels.regiao, region));
}
