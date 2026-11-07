// Dashboards de exemplo, escritos à mão, só para provar o portal: vários dashboards, permissões e cartões.
// Três têm recorte, cada um com um nome e um gênero (unidade, fazenda, talhão), e um não tem recorte.
// Sem banco de dados real, sem rede e sem dado real: cada rota devolve linhas fixas, filtradas pela permissão que recebeu.
import { permissionNote } from "../../server/agent/agent.ts";
import type { Turn } from "../../server/agent/types.ts";
import type { Dashboard } from "../../server/dashboard.ts";
import { BadRequest } from "../../server/errors.ts";
import type { DashboardScope } from "../../shared/scope.ts";

export type Seen = { slug: string; route: string; scope: string[] };

type Spec = {
  slug: string;
  name: string;
  question: string;
  source: string;
  /** O recorte de acesso. Sem ele, o dashboard só tem acesso "com" ou "sem", e as rotas recebem sempre []. */
  scope?: DashboardScope;
  /** Uma linha por item do recorte, com um valor fixo. */
  values: Record<string, number>;
  /** Sem recorte, o total que a rota devolve. */
  total?: number;
  /** Se a resposta do agente traz a nota de permissão que a instrução dele receberia (para provar que existe, ou que não existe). */
  showNote?: boolean;
  updatedAt: string | null;
  /** Se o cartão declara agente. */
  agent: boolean;
};

/** O que cada rota recebeu, para o teste conferir que o limite do recorte chegou até a consulta. */
export const seen: Seen[] = [];

/** O que o agente recebeu de contexto em cada pergunta: a conversa que o servidor guardou, e nada do que o navegador mande. */
export const asked: { slug: string; question: string; history: Turn[] }[] = [];

function example(spec: Spec): Dashboard {
  return {
    slug: spec.slug,
    card: { name: spec.name, question: spec.question, source: spec.source, agent: spec.agent },
    ...(spec.scope ? { scope: spec.scope } : {}),
    // Nada disto é aberto: o servidor abre a conexão só na primeira consulta, e estas rotas não consultam nada.
    db: { slug: spec.slug, schema: spec.slug.replaceAll("-", "_"), readTables: ["dados", "load_log"], loadTables: ["dados", "load_log"] },
    sqlite: () => ({ sql: [] }),
    async open() {
      return {
        routes: {
          dados: async (query, scope) => {
            seen.push({ slug: spec.slug, route: "dados", scope });
            // Parâmetro desconhecido é erro, como nos dashboards de verdade.
            for (const key of query.keys()) if (key !== "ano") throw new BadRequest(`Filtro desconhecido: ${key}.`);
            if (!spec.scope) return { rows: [{ valor: spec.total ?? 0 }], total: spec.total ?? 0 };
            return { rows: scope.map((code) => ({ uf: code, valor: spec.values[code] ?? 0 })), total: scope.reduce((sum, code) => sum + (spec.values[code] ?? 0), 0) };
          },
        },
        info: (scope) => ({ canCheck: !spec.scope || scope.length === spec.scope.items.length }),
        updatedAt: async () => spec.updatedAt,
        ...(spec.agent ? {
          agent: {
            simulated: { send: async () => ({ text: "", toolCalls: [] }) },
            async ask(question: string, screen: URLSearchParams, scope: string[], _model: unknown, _onFailure: unknown, history: Turn[]) {
              seen.push({ slug: spec.slug, route: "agent", scope });
              asked.push({ slug: spec.slug, question, history });
              const names = scope.map((code) => spec.scope?.items.find((item) => item.code === code)?.name ?? code);
              const note = spec.showNote ? permissionNote(spec.scope, names) : "";
              return { status: "answered" as const, text: `${spec.name}: ${question} (${scope.join(",")})${note}`, sources: [], updatedAt: spec.updatedAt, truncated: false, warnings: [], screen: screen.get("ano") ? `Ano: ${screen.get("ano")}` : "sem filtros" };
            },
          },
        } : {}),
      };
    },
  };
}

export const exemploA = example({
  slug: "exemplo-a",
  name: "Exemplo A",
  question: "Quanto cada unidade do exemplo A vendeu?",
  source: "Planilha de exemplo A",
  scope: { label: { singular: "unidade", plural: "unidades", gender: "f" }, items: [{ code: "A1", name: "Alfa" }, { code: "A2", name: "Beta" }, { code: "A3", name: "Gama" }] },
  values: { A1: 10, A2: 20, A3: 30 },
  updatedAt: "2026-10-30T10:00:00.000Z",
  agent: true,
});

export const exemploB = example({
  slug: "exemplo-b",
  name: "Exemplo B",
  question: "Quanto cada unidade do exemplo B comprou?",
  source: "Planilha de exemplo B",
  scope: { label: { singular: "fazenda", plural: "fazendas", gender: "f" }, items: [{ code: "B1", name: "Delta" }, { code: "B2", name: "Épsilon" }] },
  values: { B1: 100, B2: 200 },
  updatedAt: null,
  agent: false,
});

/** Com agente: serve para provar que a conversa de um dashboard não aparece em outro. O recorte é masculino ("talhão"), e a resposta traz a nota de permissão. */
export const exemploC = example({
  slug: "exemplo-c",
  name: "Exemplo C",
  question: "Quanto cada unidade do exemplo C vendeu?",
  source: "Planilha de exemplo C",
  scope: { label: { singular: "talhão", plural: "talhões", gender: "m" }, items: [{ code: "C1", name: "Ômega" }, { code: "C2", name: "Sigma" }] },
  values: { C1: 1, C2: 2 },
  updatedAt: null,
  agent: true,
  showNote: true,
});

/** Sem recorte, com agente: o acesso é "com" ou "sem", as rotas recebem [] e a resposta do agente prova que não há nota de permissão. */
export const exemploD = example({
  slug: "exemplo-d",
  name: "Exemplo D",
  question: "Quanto o exemplo D vendeu no total?",
  source: "Planilha de exemplo D",
  values: {},
  total: 7,
  updatedAt: null,
  agent: true,
  showNote: true,
});
