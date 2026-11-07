// O que o portal precisa saber de cada dashboard. Um dashboard novo é uma pasta em dashboards/ com um objeto deste tipo,
// listado em server/dashboards.ts. O portal não conhece consulta, carga nem tela de nenhum deles.
import type { DashboardScope } from "../shared/scope.ts";
import type { AgentAnswer, ModelAdapter, Turn } from "./agent/types.ts";
import type { DashboardDb } from "./db/open.ts";
import type { Db } from "./db/types.ts";

/**
 * Uma rota de dados: os filtros vêm da URL, e a permissão vem da sessão: a lista de códigos do recorte que a pessoa pode ver.
 * Num dashboard sem recorte, a lista é sempre vazia, e a consulta não deve filtrar por ela.
 */
export type DataRoute = (query: URLSearchParams, scope: string[]) => Promise<unknown>;

export type DashboardApi = {
  /** GET /api/d/<slug>/<nome>. */
  routes: Record<string, DataRoute>;
  /** O que a tela precisa saber além das rotas, como "tem filtro por mês" e "pode abrir a conferência". */
  info(scope: string[]): Record<string, unknown>;
  /** Data da última carga concluída, para o cartão do portal. Nulo se ainda não houve. */
  updatedAt(): Promise<string | null>;
  /** O agente deste dashboard, obrigatório se card.agent for verdadeiro. A instrução e as ferramentas são dele; o modelo vem da configuração. */
  agent?: {
    simulated: ModelAdapter;
    /** history: as últimas trocas da conversa, guardadas pelo servidor, como contexto. A resposta traz o recorte de filtros da tela em "screen". */
    ask(question: string, screen: URLSearchParams, scope: string[], model: ModelAdapter, onFailure: (error: unknown) => void, history: Turn[]): Promise<AgentAnswer>;
    /** O modelo simulado diz que é simulado, na tela. */
    simulatedLabel?: string;
  };
};

export type Dashboard = {
  /** Vai no endereço: /d/<slug> na tela e /api/d/<slug>/ na API. Letras minúsculas, números e hífen. */
  slug: string;
  /**
   * O cartão do portal. "agent" diz se o dashboard tem agente: só nos que têm aparece o botão do chat e vale a rota /api/d/<slug>/agent.
   * O provedor do agente (API ou assinatura) é um só por projeto, no .env.
   */
  card: { name: string; question: string; source: string; agent: boolean };
  /**
   * O recorte de acesso, se o dashboard tiver um (estado, fazenda, unidade...): o nome dele e os itens que o administrador pode marcar por pessoa.
   * O código de cada item é o que as consultas usam para a permissão. Sem recorte, o acesso é "com" ou "sem", e as rotas recebem sempre [].
   */
  scope?: DashboardScope;
  db: DashboardDb;
  /** Verdadeiro se o dashboard ainda só roda em Postgres. No SQLite, ele responde que não funciona, em vez de um número errado, e não ganha arquivo. */
  postgresOnly?: boolean;
  /** Arquivos SQL que criam as tabelas no SQLite, na ordem, e a escala do valor em R$ (casas decimais). */
  sqlite(env: NodeJS.ProcessEnv): { sql: string[]; valueScale?: number };
  /** Abre as consultas sobre a conexão de leitura. Falha aqui impede o servidor de subir. */
  open(reader: Db, env: NodeJS.ProcessEnv): Promise<DashboardApi>;
};

export const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Confere os dashboards do projeto antes de o servidor subir. Um recorte mal descrito poria a permissão em risco, então não sobe:
 * ainda com "states", sem itens, com código repetido ou vazio, ou com o nome do recorte incompleto.
 */
export function validateDashboards(dashboards: Dashboard[]): void {
  for (const dashboard of dashboards) {
    const { slug } = dashboard;
    if ("states" in dashboard) {
      throw new Error(`O dashboard ${slug} ainda declara "states". Troque por scope: { label: { singular, plural, gender }, items: <a mesma lista> }: veja "Acrescentar um dashboard" no README.`);
    }
    const { scope } = dashboard;
    if (scope === undefined) continue;
    const { label, items } = scope;
    const named = (text: unknown) => typeof text === "string" && text.trim() !== "";
    if (!label || !named(label.singular) || !named(label.plural) || (label.gender !== "f" && label.gender !== "m")) {
      throw new Error(`O recorte do dashboard ${slug} precisa de singular, plural e gênero ("f" ou "m").`);
    }
    if (!Array.isArray(items) || items.length === 0) throw new Error(`O recorte do dashboard ${slug} não tem itens.`);
    const seen = new Set<string>();
    for (const item of items) {
      if (!named(item?.code)) throw new Error(`O recorte do dashboard ${slug} tem um item sem código.`);
      if (seen.has(item.code)) throw new Error(`O recorte do dashboard ${slug} repete o código ${item.code}.`);
      seen.add(item.code);
    }
  }
}
