// O que é específico do dashboard fica em server/domain e web/src/domain.

import type { DashboardScope, ScopeLabel } from "../../../shared/scope.ts";
import { BadRequest } from "../../../server/errors.ts";

export { BadRequest, Forbidden } from "../../../server/errors.ts";

export type Filters = {
  year: number | null;
  region: string | null;
  state: string | null;
  crop: string | null;
  // Só existe com o mês ligado (MONTH_FILTER=on).
  month?: number | null;
};

export const ALL_YEARS = "todos";

/** Dimensão opcional: vazio desliga, "on" liga. Outro valor impede o servidor de subir. */
export function readMonthFilter(value: string | undefined): boolean {
  if (!value) return false;
  if (value === "on") return true;
  throw new Error('MONTH_FILTER inválido: use "on" ou deixe vazio.');
}

export const NO_FILTERS: Filters = { year: null, region: null, state: null, crop: null };

/** As 27 UFs, com o código do IBGE que as consultas usam na permissão. */
export const UFS: { code: string; name: string }[] = [
  ["11", "Rondônia"], ["12", "Acre"], ["13", "Amazonas"], ["14", "Roraima"], ["15", "Pará"], ["16", "Amapá"], ["17", "Tocantins"],
  ["21", "Maranhão"], ["22", "Piauí"], ["23", "Ceará"], ["24", "Rio Grande do Norte"], ["25", "Paraíba"], ["26", "Pernambuco"],
  ["27", "Alagoas"], ["28", "Sergipe"], ["29", "Bahia"], ["31", "Minas Gerais"], ["32", "Espírito Santo"], ["33", "Rio de Janeiro"],
  ["35", "São Paulo"], ["41", "Paraná"], ["42", "Santa Catarina"], ["43", "Rio Grande do Sul"], ["50", "Mato Grosso do Sul"],
  ["51", "Mato Grosso"], ["52", "Goiás"], ["53", "Distrito Federal"],
].map(([code, name]) => ({ code, name }));

export const ALL_STATES = UFS.map((uf) => uf.code);

/** Como o portal chama o recorte deste dashboard ("Todas as UFs", "Só estas UFs"). */
export const UF_LABEL: ScopeLabel = { singular: "UF", plural: "UFs", gender: "f" };

/** O recorte de acesso deste dashboard: as UFs que o administrador pode marcar por pessoa. */
export const SCOPE: DashboardScope = { label: UF_LABEL, items: UFS };

const FILTER_KEYS = new Set(["ano", "regiao", "uf", "lavoura"]);

const REGIONS = new Set(["Norte", "Nordeste", "Sudeste", "Sul", "Centro-Oeste"]);

function integer(name: string, value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d{1,6}$/.test(value)) throw new BadRequest(`Valor inválido em ${name}.`);
  return Number(value);
}

/**
 * Lista fechada. Parâmetro desconhecido é erro: se fosse ignorado, a tela mostraria
 * o total com aparência de filtrado.
 */
export function readFilters(query: URLSearchParams, extraKeys: string[] = [], hasMonth = false): Filters {
  for (const key of query.keys()) {
    if (!FILTER_KEYS.has(key) && !(hasMonth && key === "mes") && !extraKeys.includes(key)) throw new BadRequest(`Filtro desconhecido: ${key}.`);
    // Só um valor por filtro: o segundo seria ignorado sem aviso.
    if (query.getAll(key).length > 1) throw new BadRequest(`Filtro repetido: ${key}.`);
  }
  // Valor que não existe é erro: a tela não pode mostrar "Todos" com os números vazios.
  const region = query.get("regiao");
  if (region !== null && !REGIONS.has(region)) throw new BadRequest("Região inválida.");
  const state = query.get("uf");
  if (state !== null && !ALL_STATES.includes(state)) throw new BadRequest("UF inválida.");
  const crop = query.get("lavoura");
  if (crop !== null && !/^\d{1,12}$/.test(crop)) throw new BadRequest("Lavoura inválida.");
  const year = query.get("ano");
  const filters = { year: year === ALL_YEARS ? null : integer("ano", year), region, state, crop };
  if (!hasMonth) return filters;
  const month = query.get("mes");
  if (month !== null && !/^([1-9]|1[0-2])$/.test(month)) throw new BadRequest("Mês inválido.");
  // Somar o mesmo mês de todos os anos não é um período. Sem ano, o link mudaria de sentido ao entrar um ano novo.
  if (month !== null && (year === null || year === ALL_YEARS)) throw new BadRequest("Escolha um ano para filtrar o mês.");
  return { ...filters, month: month === null ? null : Number(month) };
}

/** Sem ano na URL, vale o mais recente. Somar todos os anos é uma escolha explícita. */
export const usesDefaultYear = (query: URLSearchParams) => !query.has("ano");

/** Área é a mesma terra a cada período, então só aparece em um período por linha. Com o mês ligado, o período é o mês. */
export const areaFits = (f: Filters, by: DetailDimension | null, hasMonth: boolean) =>
  by === (hasMonth ? "mes" : "ano") || (f.year !== null && (!hasMonth || (f.month ?? null) !== null));

const PERIOD = "to_char(make_date(year, month, 1), 'YYYY-MM')";
export const SQLITE_PERIOD = "printf('%04d-%02d', year, month)";

// "sqlite" é a versão da mesma coluna naquele motor, quando a sintaxe muda.
export const DETAIL_DIMENSIONS: Record<string, { column: string; label: string; sqlite?: string }> = {
  ano: { column: "year::text", label: "year::text", sqlite: "CAST(year AS TEXT)" },
  // Só com o mês ligado: readDetail recusa nos outros casos.
  mes: { column: PERIOD, label: PERIOD, sqlite: SQLITE_PERIOD },
  regiao: { column: "region", label: "region" },
  uf: { column: "state_code", label: "state_name" },
  lavoura: { column: "crop_code", label: "crop_name" },
};

export type DetailDimension = "ano" | "mes" | "regiao" | "uf" | "lavoura";

// Lista fechada: a coluna de ordenação nunca vem do navegador.
// Nomes em ordem de dicionário do português: exige um Postgres com ICU.
export const PT_BR = 'COLLATE "pt-BR-x-icu"';
const LINE_ORDER: Record<string, string> = {
  valor: "value_brl", quantidade: "quantity_t", area: "area_ha", ano: "year", mes: "make_date(year, month, 1)",
  uf: `state_name ${PT_BR}`, regiao: `region ${PT_BR}`, lavoura: `crop_name ${PT_BR}`,
};
const GROUP_ORDER: Record<string, string> = {
  valor: "SUM(value_brl)", quantidade: "SUM(quantity_t)", area: "SUM(area_ha)", nome: "$LABEL",
};

export function readDetail(query: URLSearchParams, hasMonth = false): { by: DetailDimension | null; page: number; order: string; orderName: string } {
  const by = query.get("por");
  if (by !== null && (!Object.hasOwn(DETAIL_DIMENSIONS, by) || (by === "mes" && !hasMonth))) throw new BadRequest("Dimensão de detalhe inválida.");
  const page = integer("pagina", query.get("pagina")) ?? 1;
  if (page < 1) throw new BadRequest("Página inválida.");
  const name = query.get("ordem") ?? "valor";
  const columns = by === null ? LINE_ORDER : GROUP_ORDER;
  if (!Object.hasOwn(columns, name) || (name === "mes" && !hasMonth)) throw new BadRequest("Ordem inválida.");
  const direction = query.get("dir") ?? "desc";
  if (direction !== "asc" && direction !== "desc") throw new BadRequest("Direção inválida.");
  return { by: by as DetailDimension | null, page, order: `${columns[name]} ${direction.toUpperCase()} NULLS LAST`, orderName: name };
}
