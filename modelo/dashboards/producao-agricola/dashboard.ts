// A descrição deste dashboard para o portal: cartão, recorte de acesso (as UFs), onde moram os dados e como abrir as consultas.
// A pasta inteira é dele: consultas (domain), carga (load), agente (agent), tela (web), SQL (sql) e testes (test).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { answer, permissionNote } from "../../server/agent/agent.ts";
import type { Dashboard } from "../../server/dashboard.ts";
import { DatabaseUnavailable } from "../../server/db/types.ts";
import { describeScreen, TOOLS, type AgentContext } from "./agent/tools.ts";
import { REFUSAL, SYSTEM_PROMPT } from "./agent/prompt.ts";
import { simulatedModel } from "./agent/simulatedModel.ts";
import { ALL_STATES, readMonthFilter, SCOPE, UFS, usesDefaultYear } from "./domain/filters.ts";
import { DB } from "./db.ts";
import { createQueries } from "./domain/queries.ts";
import { createDataRoutes } from "./domain/routes.ts";

const sql = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), "sql", name);

export const producaoAgricola: Dashboard = {
  slug: "producao-agricola",
  card: {
    name: "Produção agrícola",
    question: "Quanto o Brasil produz de cada lavoura, em quais estados e como isso evolui ano a ano?",
    source: "IBGE, Produção Agrícola Municipal",
    agent: true,
  },
  scope: SCOPE,
  db: DB,
  sqlite: (env) => ({
    sql: [sql("sqlite_schema.sql"), ...(readMonthFilter(env.MONTH_FILTER) ? [sql("sqlite_optional_month.sql")] : [])],
    valueScale: Number(env.SQLITE_VALUE_SCALE || 2),
  }),

  async open(reader, env) {
    // Dimensão opcional. Como ligar: seção "Ligar o mês" do README.
    const hasMonth = readMonthFilter(env.MONTH_FILTER);
    const queries = createQueries(reader, { hasMonth });
    const { routes, filtersOf, withMeta, check } = createDataRoutes(queries, hasMonth);
    if (hasMonth) {
      // Sem a coluna, toda consulta falharia: melhor não subir, e dizer por quê.
      await reader.query("SELECT month FROM production LIMIT 0").catch((error) => {
        // Banco ainda não criado não é erro de configuração: a tela avisa, e a carga resolve.
        if (error instanceof DatabaseUnavailable) return;
        throw new Error(`MONTH_FILTER=on exige a coluna month em production: veja sql/optional_month.sql. ${error.message}`);
      });
    }
    // O SQLite é um arquivo: se ele ainda não existe, quem olha o terminal já fica sabendo.
    if (reader.engine === "sqlite") await queries.latestYear([]).catch((error) => console.error(error.message));

    return {
      routes: {
        ...routes,
        ...(hasMonth ? { "by-month": async (query, scope) => withMeta(await queries.byMonth(await filtersOf(query, scope), scope)) } : {}),
        check: (_query, scope) => check(scope),
      },
      info: (scope) => ({ canCheck: scope.length === ALL_STATES.length, ...(hasMonth ? { hasMonth: true } : {}) }),
      updatedAt: async () => (await queries.meta()).updatedAt,
      agent: {
        simulated: simulatedModel,
        async ask(question, screen, scope, model, onFailure, history) {
          const filters = await filtersOf(screen, scope);
          const ctx: AgentContext = { filters, yearIsDefault: usesDefaultYear(screen), scope, data: queries };
          const names = new Map(UFS.map((uf) => [uf.code, uf.name]));
          const systemPrompt = SYSTEM_PROMPT + permissionNote(SCOPE, scope.map((code) => names.get(code) ?? code));
          return answer(question, ctx, model, { systemPrompt, tools: TOOLS, describeScreen, refusal: REFUSAL }, onFailure, undefined, history);
        },
      },
    };
  },
};
