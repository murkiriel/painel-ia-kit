// Site estático: o que é publicado, o nome de cada arquivo e como a tela lê. Sem React nem banco.
// Regra central: cada arquivo é a resposta da API para a mesma consulta. Sem arquivo para a consulta, a tela
// avisa, e nunca mostra outro número. O que é específico do exemplo são as dimensões e o corte em isPublished.
import { panelQuery } from "../../../shared/filters.ts";

export const DATA_DIR = "dados";
export const MANIFEST_FILE = `${DATA_DIR}/manifest.json`;

export const SITE_ROUTES = ["filter-options", "summary", "by-year", "by-region", "by-state", "by-crop", "detail"] as const;
export type SiteRoute = (typeof SITE_ROUTES)[number];

/** O índice do site: o que existe e de quando são os dados. As listas servem para recusar link inválido, como a API. */
export type SiteManifest = {
  publicData: true;
  generatedAt: string;
  updatedAt: string;
  years: string[];
  /** Cada UF e a região dela. */
  states: Record<string, string>;
  crops: string[];
  /** Só as lavouras que existem na região, em algum ano. */
  regionCrops: Record<string, string[]>;
  files: number;
  bytes: number;
  /** Nomes e tamanhos de tudo o que foi gerado: outro arquivo na pasta impede de apagá-la. */
  filesHash?: string;
};

export const ALL_YEARS = "todos";
const DEFAULT_ORDER = "valor";
export const DETAIL_VIEWS = [null, "ano", "regiao", "uf", "lavoura"] as const;
export type DetailView = (typeof DETAIL_VIEWS)[number];
const LINE_ORDERS = ["valor", "quantidade", "area", "ano", "uf", "regiao", "lavoura"];
const GROUP_ORDERS = ["valor", "quantidade", "area", "nome"];
const STALE_DAYS = 45;

/** A falha, sem depender da tela: link inválido, combinação fora do publicado ou arquivo ausente. */
export class SiteFailure extends Error {
  kind: "invalid" | "unpublished" | "absent";
  constructor(kind: SiteFailure["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

const orderedText = (query: URLSearchParams) => {
  query.sort();
  return query.toString();
};

/** Coluna que aparece como "—" não ordena: a API ignora essa ordem, e o resultado é o da ordem padrão. */
export function isHiddenOrder(query: URLSearchParams): boolean {
  const by = query.get("por");
  const name = query.get("ordem");
  if (by === null) return false;
  if (name === "quantidade") return !query.has("lavoura") && by !== "lavoura";
  return name === "area" && by !== "ano" && query.get("ano") === ALL_YEARS;
}

/** A mesma tabela tem um texto só: a ordem padrão não aparece, nem a primeira página. */
function canonicalDetail(query: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(query);
  const name = next.get("ordem") ?? DEFAULT_ORDER;
  const direction = next.get("dir") ?? "desc";
  next.delete("ordem");
  next.delete("dir");
  if ((name !== DEFAULT_ORDER || direction !== "desc") && !isHiddenOrder(query)) {
    next.set("ordem", name);
    next.set("dir", direction);
  }
  // Como a API, que lê um número: "01" é a página 1.
  const page = next.get("pagina");
  if (page !== null && /^\d+$/.test(page)) {
    if (Number(page) === 1) next.delete("pagina");
    else next.set("pagina", String(Number(page)));
  }
  return next;
}

/** Caminho do arquivo. O nome é o próprio texto da consulta. UF com a região dela responde igual à UF sozinha, menos nas listas dos seletores. */
export function fileOf(route: SiteRoute, query: string): string {
  const params = new URLSearchParams(query);
  const next = route === "detail" ? canonicalDetail(params) : params;
  if (route !== "filter-options" && next.has("uf")) next.delete("regiao");
  // Como a API, que lê um número: "02024" é 2024.
  const year = next.get("ano");
  if (year !== null && /^\d+$/.test(year)) next.set("ano", String(Number(year)));
  return `${DATA_DIR}/${route}/${orderedText(next) || "index"}.json`;
}

const hasOtherOrder = (query: URLSearchParams) => canonicalDetail(query).has("ordem");

const isOrderLocked = (query: URLSearchParams) => query.has("lavoura") && query.has("regiao");

/** Com lavoura e região juntas, a tabela fica na ordem padrão. Em outra ordem, só a primeira página é publicada. */
export function isOrderPublished(query: URLSearchParams): boolean {
  if (!hasOtherOrder(query)) return true;
  return !isOrderLocked(query) && Number(query.get("pagina") ?? 1) <= 1;
}

/** O corte do site: uma lavoura não se combina com uma UF. Região com lavoura, sim, se a lavoura existe na região. */
export function isPublished(route: SiteRoute, query: string, manifest: SiteManifest): boolean {
  const params = new URLSearchParams(query);
  const region = params.get("regiao");
  const state = params.get("uf");
  const crop = params.get("lavoura");
  if (state !== null && crop !== null) return false;
  if (state !== null && region !== null && manifest.states[state] !== region) return false;
  if (crop !== null && region !== null && !manifest.regionCrops[region]?.includes(crop)) return false;
  if (route === "by-year" && params.get("ano") !== ALL_YEARS) return false;
  return route !== "detail" || isOrderPublished(params);
}

/** Por que a consulta não foi publicada, para a tela dizer. */
function unpublishedReason(query: string, manifest: SiteManifest): string {
  const params = new URLSearchParams(query);
  const state = params.get("uf");
  if (state !== null && params.has("lavoura")) return "UF e lavoura não se combinam como filtro. O valor de cada UF em uma lavoura está no mapa, no gráfico por UF e no detalhe.";
  if (state !== null && params.has("regiao") && manifest.states[state] !== params.get("regiao")) return "Esta UF não faz parte desta região.";
  if (params.has("regiao") && params.has("lavoura") && !manifest.regionCrops[params.get("regiao")!]?.includes(params.get("lavoura")!)) return "Esta lavoura não tem produção nesta região em nenhum ano.";
  return "A tabela não tem esta ordem ou esta página neste recorte. Todas as páginas estão na ordem por valor, do maior para o menor.";
}

/** As mesmas recusas da API, com as mesmas mensagens. Devolve null se o link está certo. */
export function linkProblem(route: SiteRoute, query: string, manifest: SiteManifest): string | null {
  const params = new URLSearchParams(query);
  const extra = route === "detail" ? ["por", "pagina", "ordem", "dir"] : [];
  if (route === "detail") {
    const by = params.get("por");
    if (by !== null && !DETAIL_VIEWS.includes(by as DetailView)) return "Dimensão de detalhe inválida.";
    const page = params.get("pagina");
    if (page !== null && !/^\d{1,6}$/.test(page)) return "Valor inválido em pagina.";
    if (page !== null && Number(page) < 1) return "Página inválida.";
    if (!(by === null ? LINE_ORDERS : GROUP_ORDERS).includes(params.get("ordem") ?? DEFAULT_ORDER)) return "Ordem inválida.";
    if (!["asc", "desc"].includes(params.get("dir") ?? "desc")) return "Direção inválida.";
  }
  for (const key of params.keys()) {
    if (!["ano", "regiao", "uf", "lavoura", ...extra].includes(key)) return `Filtro desconhecido: ${key}.`;
    if (params.getAll(key).length > 1) return `Filtro repetido: ${key}.`;
  }
  const region = params.get("regiao");
  if (region !== null && !Object.values(manifest.states).includes(region)) return "Região inválida.";
  const state = params.get("uf");
  if (state !== null && !Object.hasOwn(manifest.states, state)) return "UF inválida.";
  const crop = params.get("lavoura");
  if (crop !== null && !/^\d{1,12}$/.test(crop)) return "Lavoura inválida.";
  const year = params.get("ano");
  if (year !== null && year !== ALL_YEARS && !/^\d{1,6}$/.test(year)) return "Valor inválido em ano.";
  if (year !== null && year !== ALL_YEARS && !manifest.years.includes(String(Number(year)))) return "Ano inválido.";
  if (crop !== null && !manifest.crops.includes(crop)) return "Lavoura inválida.";
  return null;
}

export type LoadFile = (file: string) => Promise<Record<string, any> | null>;

/** Lê a resposta de uma consulta. Só devolve o que está em um arquivo daquela mesma consulta. */
export async function readSite(route: SiteRoute, query: string, manifest: SiteManifest, load: LoadFile): Promise<unknown> {
  const problem = linkProblem(route, query, manifest);
  if (problem !== null) throw new SiteFailure("invalid", problem);
  if (!isPublished(route, query, manifest)) throw new SiteFailure("unpublished", unpublishedReason(query, manifest));

  if (route === "detail") {
    const params = canonicalDetail(new URLSearchParams(query));
    const page = Number(params.get("pagina") ?? 1);
    params.delete("pagina");
    const hadOrder = params.has("ordem");
    params.delete("ordem");
    params.delete("dir");
    // Em outra ordem ou em outra página, a primeira página diz antes o total, para não pedir um arquivo que não existe.
    const first = hadOrder || page > 1 ? await load(fileOf(route, params.toString())) : null;
    if (first !== null) {
      // Tabela de uma linha, ou vazia, não tem arquivo em outra ordem: a ordem não muda nada nela.
      if (hadOrder && first.count <= 1) return first;
      // Página além do fim: como a API, sem linhas e com o total. A tabela leva à última.
      if (!hadOrder && page > Math.ceil(first.count / first.pageSize)) return { ...first, rows: [] };
    }
  }
  const found = await load(fileOf(route, query));
  if (found !== null) return found;
  throw new SiteFailure("absent", "Falta o arquivo de dados deste bloco no site.");
}

/** Dimensões que não podem ser escolhidas agora, porque o resultado não foi publicado. */
export function blockedFilters(search: string): { uf: boolean; lavoura: boolean } {
  const query = new URLSearchParams(panelQuery(search, null));
  return { uf: query.has("lavoura"), lavoura: query.has("uf") };
}

/** Os filtros que valem na tabela, com a visão, a ordem e a página do endereço. */
function detailState(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  const state = new URLSearchParams(panelQuery(search, null));
  for (const key of ["por", "ordem", "dir", "pagina"]) {
    const value = params.get(key);
    if (value !== null) state.set(key, value);
  }
  return state;
}

/** A tabela do endereço está em outra ordem que não a padrão? */
export const isOtherOrder = (search: string) => hasOtherOrder(detailState(search));

/** Neste recorte, a tabela não ordena por outra coluna: não há arquivo. */
export const isOrderLockedAt = (search: string) => isOrderLocked(detailState(search));

/** A ordem ou a página pedida não existem neste recorte: a tabela volta à ordem padrão, ou à primeira página, e a seta diz qual vale. */
export function fixSiteLink(search: string): string | null {
  const params = new URLSearchParams(search);
  const state = detailState(search);
  if (isOrderPublished(state)) return null;
  if (isOrderLocked(state)) {
    params.delete("ordem");
    params.delete("dir");
  }
  params.delete("pagina");
  return params.toString();
}

/** Sem servidor, o aviso de dado velho é calculado no dia em que a pessoa abre: o que veio no arquivo é do dia da geração. Os mesmos 45 dias de server/domain/queries.ts. */
export function isStale(updatedAt: string | null | undefined, now: number): boolean {
  return Boolean(updatedAt) && now - new Date(updatedAt as string).getTime() > STALE_DAYS * 86_400_000;
}

export const STALE_MESSAGE = `Os dados não são atualizados há mais de ${STALE_DAYS} dias.`;

/** Para listar as ordens que o gerador publica em uma tabela: as colunas à vista, nos dois sentidos, menos a padrão. */
export function otherOrders(query: string, by: DetailView): string[] {
  const list: string[] = [];
  for (const name of by === null ? LINE_ORDERS : GROUP_ORDERS) {
    for (const direction of ["desc", "asc"]) {
      if (name === DEFAULT_ORDER && direction === "desc") continue;
      const next = new URLSearchParams(query);
      if (by !== null) next.set("por", by);
      next.set("ordem", name);
      next.set("dir", direction);
      if (!isHiddenOrder(next)) list.push(orderedText(next));
    }
  }
  return list;
}
