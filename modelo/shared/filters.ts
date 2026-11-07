// Regras dos filtros, sem React: recebem a query da URL e devolvem outra.
// A URL é a única fonte de verdade.

const SELECTION = "sel.";

// Estado de navegação: fica na URL, mas não filtra dado.
const VIEW_KEYS = new Set(["tela", "por", "pagina", "ordem", "dir"]);

/** Valor reservado para "sem informação". O rótulo aparece na tela, e o backend trata como nulo. */
export const NO_VALUE = "__vazio__";

/**
 * Liga, troca ou limpa um filtro global. A última ação vale: o clique anterior na mesma dimensão,
 * ou em uma dimensão ligada (related), sai, para o seletor e os números não dizerem coisas diferentes.
 */
export function setFilter(search: string, name: string, value: string | null, related: string[] = []): string {
  const next = new URLSearchParams(search);
  next.delete("pagina"); // o filtro muda o total de páginas
  for (const [key, text] of [...next]) {
    if (key.startsWith(SELECTION) && [name, ...related].includes(text.slice(0, text.indexOf(":")))) next.delete(key);
  }
  if (value === null) next.delete(name);
  else next.set(name, value);
  return next.toString();
}

/**
 * Clicar em um item seleciona. Clicar de novo no mesmo item limpa.
 * A última ação vale: a seleção de outro gráfico na mesma dimensão sai, para não haver duas etiquetas disputando.
 */
export function toggleSelection(search: string, panel: string, dimension: string, value: string): string {
  const next = new URLSearchParams(search);
  const key = SELECTION + panel;
  const text = `${dimension}:${value}`;
  const same = next.get(key) === text;
  next.delete("pagina");
  for (const [other, current] of [...next]) {
    if (other.startsWith(SELECTION) && current.slice(0, current.indexOf(":")) === dimension) next.delete(other);
  }
  // Apaga antes de gravar, para a seleção mais nova ficar por último na URL.
  next.delete(key);
  if (!same) next.set(key, text);
  return next.toString();
}

/** O valor selecionado em um gráfico, para destacar na tela. */
export function selectedValue(search: string, panel: string): string | null {
  const text = new URLSearchParams(search).get(SELECTION + panel);
  // O valor pode ter ":"; só o primeiro separa a dimensão.
  return text === null ? null : text.slice(text.indexOf(":") + 1);
}

/**
 * Parâmetros que um bloco envia ao backend: filtros globais mais as seleções dos
 * outros gráficos. O gráfico clicado não filtra a si mesmo. Passe panel = null no
 * bloco de detalhe, que usa todas as seleções.
 *
 * Na mesma dimensão, a seleção vale sobre o filtro global, e a mais nova vale
 * sobre as anteriores.
 */
export function panelQuery(search: string, panel: string | null): string {
  const params = new URLSearchParams(search);
  const query = new URLSearchParams();
  for (const [key, value] of params) {
    // append: filtro repetido chega ao backend, que recusa, em vez de um valor sumir em silêncio.
    if (!key.startsWith(SELECTION) && !VIEW_KEYS.has(key)) query.append(key, value);
  }
  for (const [key, value] of params) {
    if (key.startsWith(SELECTION) && key !== SELECTION + panel) {
      const split = value.indexOf(":");
      if (split > 0) query.set(value.slice(0, split), value.slice(split + 1));
    }
  }
  query.sort(); // mesma consulta, mesmo texto: evita busca repetida
  return query.toString();
}

export type ActiveSelection = { panel: string; dimension: string; value: string };

/** Todas as seleções ativas, para mostrar como etiquetas na linha de filtros. */
export function activeSelections(search: string): ActiveSelection[] {
  const active: ActiveSelection[] = [];
  for (const [key, text] of new URLSearchParams(search)) {
    if (!key.startsWith(SELECTION)) continue;
    const split = text.indexOf(":");
    if (split < 1) continue; // link malformado não vira etiqueta
    active.push({ panel: key.slice(SELECTION.length), dimension: text.slice(0, split), value: text.slice(split + 1) });
  }
  return active;
}

/**
 * Em um link antigo, o clique e o seletor podem disputar a mesma dimensão. O clique vale, e o filtro sai,
 * para o seletor e os números não dizerem coisas diferentes. A dimensão em timeDimension não usa clique:
 * vira filtro. Devolve null se o link já está certo.
 */
export function normalizeSearch(search: string, timeDimension = "ano"): string | null {
  const next = new URLSearchParams(search);
  let changed = false;
  for (const [key, text] of [...next]) {
    if (!key.startsWith(SELECTION)) continue;
    const split = text.indexOf(":");
    if (split < 1) continue;
    const dimension = text.slice(0, split);
    if (dimension === timeDimension) {
      next.delete(key);
      next.set(dimension, text.slice(split + 1));
      changed = true;
    } else if (next.has(dimension)) {
      next.delete(dimension);
      changed = true;
    }
  }
  return changed ? next.toString() : null;
}

/** Limpa só os filtros. Agrupamento e ordem da tabela são escolhas de visualização e continuam. */
/** "keep" são escolhas de visualização do dashboard que também ficam, como o tipo de valor. */
export function clearFilters(search: string, keep: string[] = []): string {
  const next = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if ((VIEW_KEYS.has(key) && key !== "pagina") || keep.includes(key)) next.append(key, value);
  }
  return next.toString();
}

/** Há algum filtro ou seleção para limpar? */
export function hasFilters(search: string, keep: string[] = []): boolean {
  return [...new URLSearchParams(search).keys()].some((key) => !VIEW_KEYS.has(key) && !keep.includes(key));
}

/** Parâmetros do bloco de detalhe: todas as seleções, mais a dimensão e a página. */
export function detailQuery(search: string): string {
  const params = new URLSearchParams(search);
  const query = new URLSearchParams(panelQuery(search, null));
  for (const key of ["por", "pagina", "ordem", "dir"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  query.sort();
  return query.toString();
}
