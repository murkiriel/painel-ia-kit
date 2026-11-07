// As rotas de dados da tela, sem HTTP. O servidor e o gerador do site estático usam as mesmas, para a resposta ser a mesma, byte a byte.
import { ALL_STATES, areaFits, BadRequest, Forbidden, readDetail, readFilters, usesDefaultYear } from "./filters.ts";
import type { Queries } from "./queries.ts";

export function createDataRoutes(queries: Queries, hasMonth: boolean) {
  const withMeta = async <T extends object>(body: T) => ({ ...body, ...(await queries.meta()) });

  /** Filtros da URL. Sem ano, vale o mais recente: somar todos é uma escolha explícita. */
  async function filtersOf(query: URLSearchParams, scope: string[], extraKeys: string[] = []) {
    const filters = readFilters(query, extraKeys, hasMonth);
    const found = await queries.exists(filters, scope);
    if (!found.year) throw new BadRequest("Ano inválido.");
    if (!found.crop) throw new BadRequest("Lavoura inválida.");
    if (!found.month) throw new BadRequest("Mês inválido.");
    return usesDefaultYear(query) ? { ...filters, year: await queries.latestYear(scope) } : filters;
  }

  const routes = {
    "filter-options": async (query: URLSearchParams, scope: string[]) => withMeta(await queries.filterOptions(scope, await filtersOf(query, scope))),
    summary: async (query: URLSearchParams, scope: string[]) => withMeta(await queries.summary(await filtersOf(query, scope), scope)),
    "by-year": async (query: URLSearchParams, scope: string[]) => withMeta(await queries.byYear(await filtersOf(query, scope), scope)),
    "by-region": async (query: URLSearchParams, scope: string[]) => withMeta(await queries.byRegion(await filtersOf(query, scope), scope)),
    "by-state": async (query: URLSearchParams, scope: string[]) => withMeta(await queries.byState(await filtersOf(query, scope), scope)),
    "by-crop": async (query: URLSearchParams, scope: string[]) => withMeta(await queries.byCrop(await filtersOf(query, scope), scope)),
    detail: async (query: URLSearchParams, scope: string[]) => {
      const { by, page, order, orderName } = readDetail(query, hasMonth);
      const filters = await filtersOf(query, scope, ["por", "pagina", "ordem", "dir"]);
      // "Por ano" mostra todos os anos, a menos que um tenha sido escolhido.
      if (by === "ano" && usesDefaultYear(query)) filters.year = null;
      // Coluna que aparece como "—" não ordena: a ordem pareceria aleatória.
      const hidden = by !== null && ((orderName === "quantidade" && filters.crop === null && by !== "lavoura") || (orderName === "area" && !areaFits(filters, by, hasMonth)));
      return withMeta(await queries.detail(filters, scope, by, page, hidden ? undefined : order));
    },
  };

  /** A conferência cobre o Brasil todo, então é restrita a quem tem acesso total. */
  async function check(scope: string[]) {
    if (scope.length !== ALL_STATES.length) throw new Forbidden();
    return withMeta({ rows: await queries.sourceCheck() });
  }

  return { routes, filtersOf, withMeta, check };
}
