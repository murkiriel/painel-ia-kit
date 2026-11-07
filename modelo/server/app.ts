// O servidor do projeto, sem framework: o portal (login, cartões, administração) e a API de cada dashboard.
// A configuração entra por parâmetro; server/main.ts lê o .env e chama createApp. Os testes chamam createApp com dashboards de exemplo.
import { createReadStream, existsSync, statSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { createAdmin } from "./admin.ts";
import { createCategories, UNCATEGORIZED } from "./categories.ts";
import { MAX_QUESTION } from "./agent/agent.ts";
import { createMemory, DEFAULT_MEMORY, type MemoryConfig } from "./agent/memory.ts";
import type { ModelAdapter } from "./agent/types.ts";
import { type Access, type Auth, createAuth, grantedScope, isLocalRequest, type Session } from "./auth.ts";
import { type Dashboard, type DashboardApi, validateDashboards } from "./dashboard.ts";
import { openAuth, openPortal, openReader, type Engine } from "./db/open.ts";
import { DatabaseUnavailable, type Db } from "./db/types.ts";
import { BadRequest, Forbidden } from "./errors.ts";

export type AppConfig = {
  dashboards: Dashboard[];
  authMode: "local" | "login";
  engine: Engine;
  /** Onde o servidor escuta, quando já existe alguém para entrar. Sem nenhum usuário, só nesta máquina. */
  host: string;
  port: number;
  cookieSecure: boolean;
  /** O texto do .env que escolhe o agente, só para dizer na tela se ele é simulado. */
  agentProvider: string;
  /** O modelo de um provedor real (API ou assinatura), ou nulo. Com "simulado", cada dashboard traz o seu. */
  model: ModelAdapter | null;
  agentLimitPerHour: number;
  /** A memória da conversa do agente e os tetos dela. Ausente é o padrão seguro. */
  agentMemory?: MemoryConfig;
  env: NodeJS.ProcessEnv;
  webDir: string;
  /** Miniaturas ficam em <dataDir>/thumbs/<slug>.png. */
  dataDir: string;
  /** Texto para a linha de "Dashboard em ...", como "SQLite em .data". */
  banner?: string;
};

class TooMany extends Error {}
class Unauthorized extends Error {}
/** Dashboard ou rota que não existe, ou que a pessoa não pode ver: a mesma resposta nos dois casos. */
class NotFound extends Error {}

const MAX_BODY = 64_000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".map": "application/json",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new BadRequest("Envie JSON.");
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > MAX_BODY) throw new BadRequest("Corpo grande demais.");
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new BadRequest("JSON inválido.");
  }
}

export async function createApp(config: AppConfig) {
  const { authMode, dashboards } = config;
  // Antes de abrir qualquer conexão: um recorte mal descrito não deixa o servidor subir.
  validateDashboards(dashboards);
  const login = authMode === "login";
  const authPool = login ? await openAuth() : null;
  const portalPool = login ? await openPortal() : null;
  const auth: Auth = createAuth(authPool, portalPool, config.cookieSecure);
  const admin = portalPool ? createAdmin(portalPool, dashboards) : null;
  const categories = createCategories(authPool);

  const apis = new Map<string, DashboardApi>();
  const readers: Db[] = [];
  for (const dashboard of dashboards) {
    const reader = await openReader(dashboard.db);
    readers.push(reader);
    const api = await dashboard.open(reader, config.env);
    // O cartão é quem diz se há agente: os dois precisam concordar, para o botão e a rota nunca divergirem.
    if (dashboard.card.agent && !api.agent) throw new Error(`O dashboard ${dashboard.slug} diz ter agente no cartão, mas não traz as ferramentas dele.`);
    apis.set(dashboard.slug, api);
  }

  // Limite de perguntas por hora. Custa dinheiro em um provedor real.
  const agentCalls = new Map<string, number[]>();
  function allowAgentCall(user: string): boolean {
    const recent = (agentCalls.get(user) ?? []).filter((at) => Date.now() - at < 3_600_000);
    if (recent.length >= config.agentLimitPerHour) return false;
    agentCalls.set(user, [...recent, Date.now()]);
    return true;
  }

  /** O modelo que atende o dashboard, ou nulo se o provedor está desligado. Só quem tem agente no cartão chega aqui. */
  const modelOf = (slug: string) => (config.agentProvider === "simulado" ? apis.get(slug)?.agent?.simulated ?? null : config.model);

  // A conversa de cada pessoa em cada dashboard, só na memória do servidor.
  const memoryConfig = config.agentMemory ?? DEFAULT_MEMORY;
  const memory = createMemory(memoryConfig);

  /** O que a pessoa pode ver deste dashboard, ou nulo se ele não existe para ela. Administrador vê tudo. Sem login, tudo, só na própria máquina. */
  function scopeOf(dashboard: Dashboard, session: Session | null, access: Access): string[] | null {
    if (!login || session?.user.isAdmin) return grantedScope(dashboard, { full: true, codes: [] });
    return grantedScope(dashboard, access[dashboard.slug]);
  }

  function requireCsrf(req: IncomingMessage, session: Session | null) {
    if (login && (!session || !auth.csrfMatches(req, session))) throw new Forbidden();
  }

  function thumbnailFile(dashboard: Dashboard) {
    return path.join(config.dataDir, "thumbs", `${dashboard.slug}.png`);
  }

  async function cardOf(dashboard: Dashboard) {
    let updatedAt: string | null = null;
    let available = true;
    try {
      updatedAt = await apis.get(dashboard.slug)!.updatedAt();
    } catch (error) {
      // Banco fora do ar não vira "sem atualização": o cartão diz que não conseguiu ler.
      if (!(error instanceof DatabaseUnavailable)) console.error(error);
      available = false;
    }
    const file = thumbnailFile(dashboard);
    const thumbnail = existsSync(file) ? `/api/d/${dashboard.slug}/thumbnail?v=${Math.round(statSync(file).mtimeMs)}` : null;
    return { slug: dashboard.slug, ...dashboard.card, updatedAt, available, thumbnail };
  }

  async function handleDashboard(req: IncomingMessage, res: ServerResponse, url: URL, session: Session | null, slug: string, rest: string) {
    const dashboard = dashboards.find((d) => d.slug === slug);
    const scope = dashboard ? scopeOf(dashboard, session, session ? await auth.access(session.user.id) : {}) : null;
    if (!dashboard || !scope) throw new NotFound();
    const api = apis.get(slug)!;
    const key = `${req.method} ${rest}`;

    if (key === "GET thumbnail") {
      const file = thumbnailFile(dashboard);
      if (!existsSync(file)) throw new NotFound();
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, no-cache" });
      return void createReadStream(file).pipe(res);
    }
    // O selo com o nome da categoria é só um enfeite: se a leitura falhar, o dashboard abre sem ele.
    if (key === "GET info") return sendJson(res, 200, { ...api.info(scope), category: await categories.nameOf(slug).catch(() => null) });
    // Sem agente no cartão, a rota não existe: a recusa é a mesma de qualquer rota que não existe.
    if (rest === "agent" && !dashboard.card.agent) throw new NotFound();
    // A conversa é de quem pergunta, neste dashboard, com esta permissão. Se a permissão muda, ela começa do zero.
    const user = String(session?.user.id ?? "local");
    // Sem recorte, ou com a lista cobrindo o recorte inteiro, a permissão é "tudo".
    const scopeKey = !dashboard.scope || scope.length === dashboard.scope.items.length ? "tudo" : [...scope].sort().join(",");
    if (key === "GET agent") {
      const model = modelOf(slug);
      return sendJson(res, 200, {
        enabled: model !== null && api.agent !== undefined,
        simulated: config.agentProvider === "simulado",
        memory: { turns: memoryConfig.turns, idleMinutes: memoryConfig.idleMinutes },
        // O que o servidor guardou: a tela mostra isto, para nunca divergir dele.
        conversation: memory.peek(user, slug, scopeKey).map(({ question, answer }) => ({ question, answer })),
      });
    }
    if (key === "DELETE agent") {
      requireCsrf(req, session);
      memory.clear(user, slug);
      return sendJson(res, 200, { ok: true });
    }
    if (key === "POST agent") {
      requireCsrf(req, session);
      const model = modelOf(slug);
      if (!model || !api.agent) throw new BadRequest("O agente não está ligado.");
      const body = await readJson(req);
      if (!allowAgentCall(user)) throw new TooMany();
      const screen = new URLSearchParams(String(body.query ?? ""));
      const question = String(body.question ?? "");
      // Só a memória do servidor vira contexto. Qualquer histórico que o navegador mande no corpo é ignorado.
      const { history, ticket } = memory.begin(user, slug, scopeKey);
      const { screen: filters, ...result } = await api.agent.ask(question, screen, scope, model, (error) => console.error("Falha no agente:", error), history);
      if (result.status !== "failed" && question.trim() !== "" && question.length <= MAX_QUESTION) {
        memory.add(user, slug, ticket, { question, answer: result, screen: filters ?? "" });
      }
      // Registro sem a pergunta, que é texto livre e pode trazer dado pessoal.
      console.log(JSON.stringify({ event: "agent", at: new Date().toISOString(), dashboard: slug, user, status: result.status, tools: result.sources.length }));
      return sendJson(res, 200, result);
    }
    const route = req.method === "GET" ? api.routes[rest] : undefined;
    if (!route || !Object.hasOwn(api.routes, rest)) throw new NotFound();
    return sendJson(res, 200, await route(url.searchParams, scope));
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    try {
      const key = `${req.method} ${url.pathname}`;

      if (key === "GET /api/me") {
        const session = login ? await auth.session(req) : null;
        // Primeiro acesso, sem nenhum usuário: a criação só é oferecida a quem está nesta máquina.
        const firstLogin = login && !session && !(await auth.hasUsers()) ? (isLocalRequest(req) ? "here" : "elsewhere") : null;
        return sendJson(res, 200, {
          mode: authMode,
          user: session ? { name: session.user.name, isAdmin: session.user.isAdmin } : null,
          csrf: session?.csrf ?? null,
          mustChangePassword: session?.user.mustChangePassword ?? false,
          ...(firstLogin ? { firstLogin } : {}),
        });
      }
      if (key === "POST /api/first-login") {
        if (!login) throw new BadRequest("Este modo não tem login.");
        if (!isLocalRequest(req)) throw new Forbidden();
        const body = await readJson(req);
        const problem = await auth.createFirstUser(body.login, body.password);
        if (problem === "invalid") return sendJson(res, 400, { error: "No usuário, use letras, números e . _ @ -. A senha precisa de pelo menos 8 caracteres, diferente do usuário." });
        if (problem === "exists") return sendJson(res, 409, { error: "O primeiro login já foi criado." });
        if (listeningHost !== config.host) console.log("Primeiro login criado. Reinicie o servidor para abrir o portal na rede.");
        const session = await auth.login(String(body.login), String(body.password), req.socket.remoteAddress ?? "", res);
        if (!session || session === "blocked") return sendJson(res, 401, { error: "Login criado. Entre com o usuário e a senha." });
        return sendJson(res, 200, { user: { name: session.user.name, isAdmin: session.user.isAdmin }, csrf: session.csrf, mustChangePassword: false });
      }
      if (key === "POST /api/login") {
        if (!login) throw new BadRequest("Este modo não tem login.");
        const body = await readJson(req);
        // Só texto: um objeto viraria "[object Object]", e uma lista viraria o que tem dentro.
        if (typeof body.login !== "string" || typeof body.password !== "string") return sendJson(res, 401, { error: "Usuário ou senha incorretos." });
        const session = await auth.login(body.login, body.password, req.socket.remoteAddress ?? "", res);
        if (session === "blocked") return sendJson(res, 429, { error: "Muitas tentativas. Tente de novo mais tarde." });
        if (!session) return sendJson(res, 401, { error: "Usuário ou senha incorretos." });
        return sendJson(res, 200, { user: { name: session.user.name, isAdmin: session.user.isAdmin }, csrf: session.csrf, mustChangePassword: session.user.mustChangePassword });
      }

      // Daqui em diante, só quem entrou. Sem login, só na própria máquina.
      const session = login ? await auth.session(req) : null;
      if (login && !session) throw new Unauthorized();

      if (key === "POST /api/logout") {
        requireCsrf(req, session);
        if (session) {
          memory.clearUser(String(session.user.id));
          await auth.logout(session, res);
        }
        return sendJson(res, 200, { ok: true });
      }
      if (key === "POST /api/password") {
        if (!session) throw new BadRequest("Este modo não tem login.");
        requireCsrf(req, session);
        const body = await readJson(req);
        const problem = await auth.changePassword(session, body.current, body.next);
        if (problem === "wrong") return sendJson(res, 400, { error: "A senha atual não confere." });
        if (problem === "same") return sendJson(res, 400, { error: "Escolha uma senha diferente da atual." });
        if (problem === "invalid") return sendJson(res, 400, { error: "A senha precisa de pelo menos 8 caracteres, diferente do usuário." });
        return sendJson(res, 200, { ok: true });
      }

      // Senha provisória: nada além de trocá-la, sair e ver quem é.
      if (session?.user.mustChangePassword) return sendJson(res, 403, { error: "Troque a senha provisória para continuar." });

      if (key === "GET /api/dashboards") {
        const access = session ? await auth.access(session.user.id) : {};
        const visible = dashboards.filter((d) => scopeOf(d, session, access) !== null);
        // Os cartões saem agrupados, na ordem das categorias. Só saem as categorias com dashboard visível para esta pessoa.
        const placement = await categories.place(visible.map((d) => d.slug));
        const sections = [
          ...placement.categories.map((c) => ({ id: c.id as string | null, name: c.name, slugs: c.slugs })),
          ...(placement.uncategorized.length ? [{ id: null as string | null, name: UNCATEGORIZED, slugs: placement.uncategorized }] : []),
        ];
        const cards = new Map((await Promise.all(visible.map(cardOf))).map((card) => [card.slug, card]));
        return sendJson(res, 200, {
          dashboards: sections.flatMap((section) => section.slugs.map((slug) => cards.get(slug)!)),
          // O título da seção só aparece com mais de uma: com uma só, o portal fica como sempre foi.
          sections: sections.map((section) => ({ ...section, title: sections.length > 1 })),
        });
      }

      if (url.pathname.startsWith("/api/admin/")) {
        // Só o administrador. Quem não é recebe a mesma recusa para qualquer rota daqui, existente ou não.
        if (!session?.user.isAdmin || !admin) throw new Forbidden();
        if (key === "GET /api/admin/overview") return sendJson(res, 200, { users: await admin.users(), ...(await admin.catalog()) });
        if (req.method === "POST") {
          requireCsrf(req, session);
          const body = await readJson(req);
          if (key === "POST /api/admin/create-user") return sendJson(res, 200, await admin.createUser(body.login, body.name));
          if (key === "POST /api/admin/set-access") return sendJson(res, 200, (await admin.setAccess(body.userId, body.dashboard, body.mode, body.codes), { ok: true }));
          if (key === "POST /api/admin/set-active") return sendJson(res, 200, (await admin.setActive(body.userId, body.active), { ok: true }));
          if (key === "POST /api/admin/reset-password") return sendJson(res, 200, await admin.resetPassword(body.userId));
          if (key === "POST /api/admin/create-category") return sendJson(res, 200, await admin.createCategory(body.name));
          if (key === "POST /api/admin/rename-category") return sendJson(res, 200, (await admin.renameCategory(body.id, body.name), { ok: true }));
          if (key === "POST /api/admin/move-category") return sendJson(res, 200, (await admin.moveCategory(body.id, body.direction), { ok: true }));
          if (key === "POST /api/admin/delete-category") return sendJson(res, 200, (await admin.deleteCategory(body.id), { ok: true }));
          if (key === "POST /api/admin/set-dashboard-category") return sendJson(res, 200, (await admin.setDashboardCategory(body.dashboard, body.categoryId), { ok: true }));
          if (key === "POST /api/admin/set-category-access") return sendJson(res, 200, (await admin.setCategoryAccess(body.userId, body.categoryId, body.mode), { ok: true }));
        }
        throw new NotFound();
      }

      const match = /^\/api\/d\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (match) return await handleDashboard(req, res, url, session, match[1], match[2]);
      throw new NotFound();
    } catch (error) {
      if (error instanceof NotFound) return sendJson(res, 404, { error: "Rota não encontrada." });
      if (error instanceof BadRequest) return sendJson(res, 400, { error: error.message });
      if (error instanceof Unauthorized) return sendJson(res, 401, { error: "Faça login." });
      if (error instanceof Forbidden) return sendJson(res, 403, { error: "Sem permissão." });
      if (error instanceof TooMany) return sendJson(res, 429, { error: "Muitas perguntas nesta hora. Tente mais tarde." });
      if (error instanceof DatabaseUnavailable) return sendJson(res, 503, { error: error.message });
      // O detalhe pode trazer SQL: fica no registro, não na resposta.
      console.error(error);
      sendJson(res, 500, { error: "Erro interno." });
    }
  }

  /** Telas do portal que o navegador abre direto: o início, a administração e cada dashboard. Qualquer outro endereço é "não encontrado". */
  const isScreen = (pathname: string) => pathname === "/" || pathname === "/admin" || pathname === "/senha" || /^\/d\/[^/]+\/?$/.test(pathname);

  function serveWeb(url: URL, res: ServerResponse) {
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end("Endereço inválido.");
    }
    const target = path.join(config.webDir, path.normalize(pathname));
    const inside = target.startsWith(config.webDir + path.sep) || target === config.webDir;
    const found = inside && existsSync(target) && statSync(target).isFile();
    if (!found && !isScreen(pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Página não encontrada.");
    }
    const file = found ? target : path.join(config.webDir, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Rode npm run build ou use npm run web.");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    // Endereço malformado não pode derrubar o servidor: é parte do que chega da rede.
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      res.writeHead(400);
      return void res.end("Endereço inválido.");
    }
    if (url.pathname.startsWith("/api/")) return void handleApi(req, res, url);
    serveWeb(url, res);
  });

  // Sem nenhum usuário, o primeiro login é criado nesta máquina: o servidor nem escuta na rede, qualquer que seja o HOST.
  // Na dúvida, como com o banco fora do ar, também não escuta.
  const usersKnown = login ? await auth.hasUsers().then((found) => (found ? "yes" : "no"), () => "unknown") : "yes";
  const listeningHost = usersKnown === "yes" ? config.host : "127.0.0.1";
  if (listeningHost !== config.host) {
    console.warn(usersKnown === "no"
      ? `Sem nenhum usuário: só nesta máquina, em vez de ${config.host}, até criar o primeiro login e reiniciar.`
      : `Banco fora do ar ao subir: só nesta máquina, em vez de ${config.host}, até reiniciar com o banco no ar.`);
  }

  return {
    server,
    listeningHost,
    listen: () => new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, listeningHost, () => resolve((server.address() as { port: number }).port));
    }),
    async close() {
      server.close();
      server.closeAllConnections();
      await Promise.allSettled([authPool?.end(), portalPool?.end(), ...readers.map((reader) => reader.end())]);
    },
  };
}
