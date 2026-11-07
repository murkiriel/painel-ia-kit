// Lê o .env e sobe o servidor. Tudo o que importa está em app.ts.
import path from "node:path";
import { createClaudeModel } from "./agent/claudeModel.ts";
import { createSubscriptionModel, DEFAULT_MODELS, loginStatus } from "./agent/subscriptionModel.ts";
import { readMemoryConfig } from "./agent/memory.ts";
import type { ModelAdapter } from "./agent/types.ts";
import { createApp } from "./app.ts";
import { readAuthMode } from "./auth.ts";
import { dataDir, readEngine, sqliteDir } from "./db/open.ts";
import { DASHBOARDS } from "./dashboards.ts";

const env = process.env;
const authMode = readAuthMode(env.AUTH_MODE);
// Postgres é o padrão. Como escolher o SQLite: seção "Escolher o banco" do README.
const engine = readEngine(env.DB_ENGINE);
const agentProvider = env.AGENT_PROVIDER ?? "";

const agentLimitPerHour = Number(env.AGENT_LIMIT_PER_HOUR || 60);
if (!Number.isInteger(agentLimitPerHour) || agentLimitPerHour < 1) throw new Error("AGENT_LIMIT_PER_HOUR precisa ser um inteiro positivo.");
// Memória da conversa do agente: valor inválido impede o servidor de subir, como nas outras variáveis.
const agentMemory = readMemoryConfig(env);

// O adaptador de um provedor real entra aqui, a partir da documentação oficial dele. O simulado é de cada dashboard.
const shared: Record<string, () => ModelAdapter> = {
  claude: () => createClaudeModel(env.AGENT_MODEL || undefined),
  assinatura: () => {
    // A assinatura é individual: com login, só serve se os usuários forem o dono dela.
    if (authMode === "login") console.warn("Agente pela assinatura com login: use só se os usuários forem o dono da assinatura. Para outras pessoas, use AGENT_PROVIDER=claude.");
    return createSubscriptionModel({
      models: env.AGENT_MODEL ? [env.AGENT_MODEL, ...DEFAULT_MODELS.slice(1)] : DEFAULT_MODELS,
      executable: env.AGENT_CLAUDE_EXE ?? "",
      token: env.AGENT_CLAUDE_TOKEN ?? "",
    });
  },
};
const real = shared[agentProvider]?.() ?? null;
if (agentProvider !== "" && agentProvider !== "simulado" && real === null) throw new Error('AGENT_PROVIDER inválido: use "simulado", "claude" ou "assinatura", ou deixe vazio.');

const app = await createApp({
  dashboards: DASHBOARDS,
  authMode,
  engine,
  // Sem login, o servidor nunca escuta na rede.
  host: authMode === "local" ? "127.0.0.1" : (env.HOST ?? "0.0.0.0"),
  port: Number(env.PORT ?? 8787),
  cookieSecure: env.COOKIE_SECURE === "true",
  agentProvider,
  model: real,
  agentLimitPerHour,
  agentMemory,
  env,
  webDir: path.resolve(env.WEB_DIR || "dist"),
  dataDir: path.resolve(dataDir()),
});
const port = await app.listen();
console.log(`Portal em http://${app.listeningHost}:${port} (modo ${authMode}${engine === "sqlite" ? `, SQLite em ${path.resolve(sqliteDir())}` : ""}${real || agentProvider === "simulado" ? `, agente ${agentProvider}` : ""}).`);

// Pela assinatura, confere o login do Claude Code logo ao subir, sem esperar a primeira pergunta. Não impede o servidor:
// o agente avisa a pessoa e entra em pausa se o login faltar. O token nunca aparece no registro.
if (agentProvider === "assinatura") {
  void loginStatus({ executable: env.AGENT_CLAUDE_EXE ?? "", token: env.AGENT_CLAUDE_TOKEN ?? "" }).then((status) =>
    console.log(status.ok ? `Agente pela assinatura: Claude Code com login${status.method ? ` (${status.method})` : ""}.` : `ATENÇÃO, agente pela assinatura: ${status.problem}`),
  );
}
