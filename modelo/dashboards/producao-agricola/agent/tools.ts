// Lista fechada de ferramentas do agente. Todas só leem.
import type { AgentTool, ParamSchema, ToolResult } from "../../../server/agent/types.ts";
import { decimal, month, moneyCompact, periodText, quantity, variation } from "../../../shared/format.ts";
import type { Filters } from "../domain/filters.ts";
import type { Queries } from "../domain/queries.ts";

/** Só o que o agente pode consultar. O tipo já impede escrita, e o teste confere o código. */
export type AgentData = Pick<Queries, "meta" | "summary" | "byYear" | "byRegion" | "byState" | "byCrop" | "filterOptions">;

export type AgentContext = {
  filters: Filters; // filtros da tela
  yearIsDefault?: boolean; // o ano é o mais recente por padrão, não uma escolha: o modelo pode pedir outro
  scope: string[]; // permissão da sessão
  data: AgentData;
};

const MAX_ROWS = 30;
const MAX_OPTIONS = 100;

const FILTER_PARAMS: Record<string, ParamSchema> = {
  ano: { type: "integer", description: "Ano da safra, como 2024." },
  regiao: { type: "string", description: "Norte, Nordeste, Sudeste, Sul ou Centro-Oeste." },
  uf: { type: "string", description: "Código da UF, como 51. Use listar_ufs para achar o código." },
  lavoura: { type: "string", description: "Código da lavoura. Use listar_lavouras para achar o código." },
};

/**
 * O modelo só estreita, nunca alarga. Se ele pede um valor diferente do filtro da tela,
 * não há o que responder dentro do filtro atual.
 */
export function narrow(screen: Filters, input: Record<string, unknown>, yearIsDefault = false): { filters: Filters; conflict: boolean } {
  const asked: Filters = {
    year: typeof input.ano === "number" ? input.ano : null,
    region: typeof input.regiao === "string" ? input.regiao : null,
    state: typeof input.uf === "string" ? input.uf : null,
    crop: typeof input.lavoura === "string" ? input.lavoura : null,
  };
  const keys = ["year", "region", "state", "crop"] as const;
  const chosen = keys.filter((key) => !(key === "year" && yearIsDefault));
  const conflict = chosen.some((key) => screen[key] !== null && asked[key] !== null && screen[key] !== asked[key]);
  const filters = { ...screen };
  if (yearIsDefault && asked.year !== null) filters.year = asked.year;
  for (const key of keys) {
    if (filters[key] === null && asked[key] !== null) Object.assign(filters, { [key]: asked[key] });
  }
  return { filters, conflict };
}

/** A origem mostra nomes, nunca códigos. */
async function describeFilters(ctx: AgentContext, filters: Filters): Promise<Record<string, string>> {
  const described: Record<string, string> = {};
  if (filters.region) described["Região"] = filters.region;
  if (!filters.state && !filters.crop) return described;
  const { labels } = await ctx.data.filterOptions(ctx.scope);
  if (filters.state) described["UF"] = labels.uf[filters.state] ?? "sem acesso";
  if (filters.crop) described["Lavoura"] = labels.lavoura[filters.crop] ?? "sem dados";
  return described;
}

/** O recorte de filtros da tela, em texto, para a memória da conversa. */
export async function describeScreen(ctx: AgentContext): Promise<string> {
  const described = await describeFilters(ctx, ctx.filters);
  if (ctx.filters.year) described["Ano"] = ctx.yearIsDefault ? `${ctx.filters.year} (o mais recente, não uma escolha)` : String(ctx.filters.year);
  return Object.entries(described).map(([name, value]) => `${name}: ${value}`).join("; ") || "sem filtros";
}

type Loaded = { rows: Record<string, string | null>[]; period?: string };

async function result(
  ctx: AgentContext,
  input: Record<string, unknown>,
  indicator: string,
  load: (filters: Filters) => Promise<Loaded>,
  maxRows = MAX_ROWS,
): Promise<ToolResult> {
  const { filters, conflict } = narrow(ctx.filters, input, ctx.yearIsDefault);
  const meta = await ctx.data.meta();
  const period = filters.year && filters.month
    ? month(`${filters.year}-${String(filters.month).padStart(2, "0")}`)
    : filters.year ? String(filters.year) : "todos os anos carregados";
  if (conflict) {
    return {
      rows: [],
      truncated: false,
      updatedAt: meta.updatedAt,
      warnings: [...meta.warnings, "A pergunta está fora do filtro atual da tela."],
      source: { indicator, period, filters: await describeFilters(ctx, ctx.filters) },
    };
  }
  const loaded = await load(filters);
  // Com o mês ligado, o período vem do resultado, como na tela. Sem o mês, o resumo não traz firstPeriod.
  const covered = !loaded.period && !filters.month ? await ctx.data.summary(filters, ctx.scope) : null;
  const shown = covered?.firstPeriod ? periodText(covered.firstPeriod, covered.lastPeriod, covered.monthsCovered) : period;
  return {
    rows: loaded.rows.slice(0, maxRows),
    truncated: loaded.rows.length > maxRows,
    updatedAt: meta.updatedAt,
    warnings: meta.warnings,
    source: { indicator, period: loaded.period ?? shown, filters: await describeFilters(ctx, filters) },
  };
}

const ranking = (name: string, label: string, description: string, field: "byRegion" | "byState" | "byCrop"): AgentTool<AgentContext> => ({
  name,
  description,
  parameters: FILTER_PARAMS,
  allowedFields: ["codigo", "nome", "valor"],
  run: (input, ctx) =>
    result(ctx, input, label, async (filters) => {
      const { rows } = await ctx.data[field](filters, ctx.scope);
      return { rows: rows.map((r) => ({ codigo: r.key, nome: r.label, valor: moneyCompact(r.value) })) };
    }),
});

function comparison(changed: boolean, added: number, addedValue: string | null, removed: number): string | null {
  if (!changed) return null;
  const parts = [];
  if (added > 0) parts.push(`${added} ${added === 1 ? "entrou" : "entraram"} (${moneyCompact(addedValue)})`);
  if (removed > 0) parts.push(`${removed} ${removed === 1 ? "saiu" : "saíram"}`);
  return `A lista de lavouras mudou: ${parts.join(" e ")}. A variação não compara a mesma lista.`;
}

export const TOOLS: AgentTool<AgentContext>[] = [
  {
    name: "resumo",
    description: "Valor da produção (R$) e área colhida (ha) no recorte. A quantidade só vem com uma lavoura escolhida, porque somar toneladas de lavouras diferentes engana. A área só vem com um ano escolhido, porque somar anos conta a mesma terra de novo. Com um ano, traz a variação nominal do valor sobre o ano anterior. O valor é nominal, sem correção pela inflação. Se o campo comparacao ou aviso_unidade vier preenchido, cite-o na resposta.",
    parameters: FILTER_PARAMS,
    allowedFields: ["valor", "quantidade", "aviso_unidade", "area", "lavouras", "variacao_valor", "valor_ano_anterior", "ano_anterior", "comparacao"],
    run: (input, ctx) =>
      result(ctx, input, "Resumo da produção", async (filters) => {
        const s = await ctx.data.summary(filters, ctx.scope);
        if (s.crops === 0) return { rows: [] };
        const verified = s.quantityUnit === "t";
        const accumulated = s.firstYear !== s.lastYear;
        return {
          period: s.firstPeriod ? periodText(s.firstPeriod, s.lastPeriod, s.monthsCovered) : s.firstYear === s.lastYear ? String(s.firstYear) : `${s.firstYear} a ${s.lastYear}`,
          rows: [{
            valor: moneyCompact(s.value),
            quantidade: s.quantity === null
              ? "só com uma lavoura escolhida"
              : `${verified ? quantity(s.quantity, "t") : decimal(s.quantity)}${accumulated ? " (acumulada)" : ""}`,
            aviso_unidade: s.quantity !== null && !verified ? "A unidade desta lavoura está a verificar." : null,
            area: s.area !== null ? quantity(s.area, "ha") : filters.month ? "sem dado neste recorte" : `só com um ${filters.year !== null && filters.month === null ? "mês" : "ano"} escolhido`,
            lavouras: decimal(s.crops),
            variacao_valor: variation(s.valueVariation),
            valor_ano_anterior: moneyCompact(s.previousValue),
            // Com o ano à vista, o modelo não precisa deduzir, e a trava de números não barra a resposta.
            ano_anterior: filters.year !== null && s.previousValue !== null ? String(filters.year - 1) : null,
            comparacao: comparison(s.listChanged, s.addedCrops, s.addedValue, s.removedCrops),
          }],
        };
      }),
  },
  ranking("por_regiao", "Valor da produção por região", "Valor da produção (R$) por região, do maior para o menor.", "byRegion"),
  ranking("por_uf", "Valor da produção por UF", "Valor da produção (R$) por UF, do maior para o menor.", "byState"),
  ranking("por_lavoura", "Valor da produção por lavoura", "As 10 maiores lavouras por valor da produção (R$), e Outros.", "byCrop"),
  {
    name: "por_ano",
    description: "Valor da produção (R$) total em cada ano carregado. Mostra sempre todos os anos, como o gráfico da tela.",
    parameters: { regiao: FILTER_PARAMS.regiao, uf: FILTER_PARAMS.uf, lavoura: FILTER_PARAMS.lavoura },
    allowedFields: ["ano", "valor"],
    run: (input, ctx) =>
      result(ctx, input, "Valor da produção por ano", async (filters) => {
        const { month: _chosenMonth, ...withoutMonth } = filters;
        const { categories, totals } = await ctx.data.byYear({ ...withoutMonth, year: null }, ctx.scope);
        return {
          period: categories.length > 1 ? `${categories[0]} a ${categories.at(-1)}` : categories[0],
          rows: categories.map((year, i) => ({ ano: year, valor: moneyCompact(totals[i]) })),
        };
      }),
  },
  {
    name: "listar_ufs",
    description: "Lista os códigos e nomes das UFs, para usar nas outras ferramentas.",
    parameters: {},
    allowedFields: ["codigo", "nome"],
    run: (input, ctx) =>
      result(ctx, input, "Lista de UFs", async () => {
        const { uf } = await ctx.data.filterOptions(ctx.scope);
        return { rows: uf.map((o) => ({ codigo: o.key, nome: o.label })) };
      }, MAX_OPTIONS),
  },
  {
    name: "listar_lavouras",
    description: "Lista os códigos e nomes das lavouras, para usar nas outras ferramentas.",
    parameters: {},
    allowedFields: ["codigo", "nome"],
    run: (input, ctx) =>
      result(ctx, input, "Lista de lavouras", async () => {
        const { lavoura } = await ctx.data.filterOptions(ctx.scope);
        return { rows: lavoura.map((o) => ({ codigo: o.key, nome: o.label })) };
      }, MAX_OPTIONS),
  },
];
