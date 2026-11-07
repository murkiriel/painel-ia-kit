// O portal de verdade, em-processo, com dois dashboards de exemplo escritos à mão (test/fixtures) e um SQLite temporário só para o portal.
// Sem rede, dado real ou credencial. Cobre login, cartões, permissão por dashboard e por recorte, miniatura, administração e senha provisória.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.ts";
import { hashPassword } from "../server/auth.ts";
import { sqliteFile } from "../server/db/open.ts";
import { createSqliteFile, openSqlite } from "../server/db/sqlite.ts";
import type { MemoryConfig } from "../server/agent/memory.ts";
import type { Dashboard } from "../server/dashboard.ts";
import { asked, exemploA, exemploB, exemploC, exemploD, seen } from "./fixtures/dashboards.ts";

const dir = mkdtempSync(path.join(tmpdir(), "dash-portal-test-"));
const PASSWORD = "senha-de-teste-1";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==", "base64");
const PORTAL_SQL = ["server/sql/sqlite_portal_schema.sql"];

type App = Awaited<ReturnType<typeof createApp>>;
type Session = { csrf: string; cookie: string };

/** Um projeto de teste: o arquivo do portal numa pasta própria, e o servidor em-processo numa porta livre. */
async function project(name: string, { seed, authMode = "login", host = "127.0.0.1", listen = true, dashboards = [exemploA, exemploB], agentMemory }: { seed?: (portal: ReturnType<typeof openSqlite>) => Promise<void>; authMode?: "login" | "local"; host?: string; listen?: boolean; dashboards?: Dashboard[]; agentMemory?: MemoryConfig } = {}) {
  const folder = path.join(dir, name);
  mkdirSync(path.join(folder, "web"), { recursive: true });
  writeFileSync(path.join(folder, "web", "index.html"), "<!doctype html><title>Painel</title>");
  createSqliteFile(path.join(folder, "portal.sqlite"), { sql: PORTAL_SQL });
  if (seed) {
    const portal = openSqlite(path.join(folder, "portal.sqlite"), null);
    await seed(portal);
    await portal.end();
  }
  // As conexões do servidor leem o motor e a pasta do ambiente, no momento em que o servidor é criado.
  process.env.DB_ENGINE = "sqlite";
  process.env.SQLITE_DIR = folder;
  const app: App = await createApp({
    dashboards, authMode, engine: "sqlite", host, port: 0, cookieSecure: false, agentProvider: "simulado", model: null,
    agentLimitPerHour: 1000, agentMemory, env: {}, webDir: path.join(folder, "web"), dataDir: folder,
  });
  // Escutar em 0.0.0.0 abriria o aviso do firewall: quem só confere o endereço não escuta.
  const port = listen ? await app.listen() : 0;
  const base = `http://127.0.0.1:${port}`;

  const call = (method: string, address: string, { session, body, token }: { session?: { cookie: string }; body?: unknown; token?: string } = {}) =>
    fetch(base + address, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(session ? { cookie: session.cookie } : {}), ...(token ? { "X-CSRF-Token": token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const get = (address: string, session?: { cookie: string }) => call("GET", address, { session });
  const post = (address: string, body: unknown, session?: Session) => call("POST", address, { session, body, token: session?.csrf });
  /** A resposta inteira, para comparar byte a byte: situação, tipo e corpo. */
  const whole = async (response: Response) => ({ status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), body: await response.text() });
  async function login(user: string, password = PASSWORD): Promise<Session> {
    const response = await call("POST", "/api/login", { body: { login: user, password } });
    assert.equal(response.status, 200, `login de ${user}`);
    const { csrf } = await response.json() as { csrf: string };
    return { csrf, cookie: response.headers.get("set-cookie")!.split(";")[0] };
  }
  const json = async (response: Response) => ({ status: response.status, body: await response.json() as Record<string, any> });
  const cards = async (session: Session) => ((await (await get("/api/dashboards", session)).json()) as { dashboards: Record<string, any>[] }).dashboards;
  return { app, base, folder, call, get, post, whole, login, json, cards, close: () => app.close() };
}

type Project = Awaited<ReturnType<typeof project>>;

const { hash, salt } = hashPassword(PASSWORD);
type Seed = { login: string; admin?: boolean; active?: boolean; provisional?: boolean; access?: Record<string, "todas" | string[]> };
const USERS: Seed[] = [
  { login: "chefe", admin: true },
  { login: "um", access: { "exemplo-a": ["A1"] } },
  { login: "dois", access: { "exemplo-a": ["A1", "A3"], "exemplo-b": ["B2"] } },
  { login: "todas", access: { "exemplo-a": "todas", "exemplo-b": "todas" } },
  { login: "soB", access: { "exemplo-b": ["B1"] } },
  { login: "nenhum" },
  { login: "inativa", active: false, access: { "exemplo-a": "todas" } },
  { login: "provisoria", provisional: true, access: { "exemplo-a": "todas" } },
];

async function seedUsers(portal: ReturnType<typeof openSqlite>, users: Seed[] = USERS) {
  for (const user of users) {
    const { rows } = await portal.query(
      "INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin, active, must_change_password) VALUES ($1, $1, $2, $3, $4, $5, $6) RETURNING id",
      [user.login, hash, salt, user.admin === true, user.active !== false, user.provisional === true],
    );
    for (const [slug, access] of Object.entries(user.access ?? {})) {
      await portal.query("INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, $2, $3, $4)", [rows[0].id, slug, access === "todas", access === "todas" ? [] : access]);
    }
  }
}

let main: Project;
let admin: ReturnType<typeof openSqlite>;
const portalRows = (sql: string, values: unknown[] = []) => admin.query(sql, values).then((result) => result.rows);

before(async () => {
  main = await project("principal", { seed: seedUsers });
  // A foto do exemplo A existe; a do B ainda não.
  mkdirSync(path.join(main.folder, "thumbs"), { recursive: true });
  writeFileSync(path.join(main.folder, "thumbs", "exemplo-a.png"), PNG);
  admin = openSqlite(path.join(main.folder, "portal.sqlite"), null);
  await startMemo();
  await startCut();
}, { timeout: 60_000 });

after(async () => {
  await admin?.end();
  await memoAdmin?.end();
  await memo?.close();
  await cutAdmin?.end();
  await cut?.close();
  await main?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

// ---------------------------------------------------------------------------------------------------------------------
// Entrada

test("login: senha certa entra; senha errada, usuário inexistente e pessoa desativada recebem a mesma resposta", async () => {
  const me = await main.json(await main.get("/api/me"));
  assert.equal(me.body.user, null);
  const wrong = await main.whole(await main.call("POST", "/api/login", { body: { login: "um", password: "errada" } }));
  const missing = await main.whole(await main.call("POST", "/api/login", { body: { login: "ninguem", password: "errada" } }));
  const inactive = await main.whole(await main.call("POST", "/api/login", { body: { login: "inativa", password: PASSWORD } }));
  assert.equal(wrong.status, 401);
  assert.deepEqual(missing, wrong);
  assert.deepEqual(inactive, wrong);
  const session = await main.login("chefe");
  const entered = await main.json(await main.get("/api/me", session));
  assert.deepEqual(entered.body.user, { name: "chefe", isAdmin: true });
  assert.equal(entered.body.mustChangePassword, false);
  assert.equal((await main.json(await main.get("/api/me", await main.login("um")))).body.user.isAdmin, false);
});

test("telas do navegador: só o início, a administração, a senha e /d/<dashboard>", async () => {
  for (const address of ["/", "/admin", "/senha", "/d/exemplo-a", "/d/qualquer-coisa"]) assert.equal((await main.get(address)).status, 200, address);
  for (const address of ["/d/a/b", "/outra", "/d/"]) assert.equal((await main.get(address)).status, 404, address);
});

// ---------------------------------------------------------------------------------------------------------------------
// Cartões

test("cartões: cada pessoa vê só os dashboards que tem, e o administrador vê todos", async () => {
  const slugs = async (user: string) => (await main.cards(await main.login(user))).map((card) => card.slug);
  assert.deepEqual(await slugs("chefe"), ["exemplo-a", "exemplo-b"]);
  assert.deepEqual(await slugs("todas"), ["exemplo-a", "exemplo-b"]);
  assert.deepEqual(await slugs("dois"), ["exemplo-a", "exemplo-b"]);
  assert.deepEqual(await slugs("um"), ["exemplo-a"]);
  assert.deepEqual(await slugs("soB"), ["exemplo-b"]);
  assert.deepEqual(await slugs("nenhum"), [], "sem dashboard nenhum, a lista é vazia");
});

test("cartão: nome, frase, fonte, data da última atualização e miniatura", async () => {
  const [a, b] = await main.cards(await main.login("todas"));
  assert.equal(a.name, "Exemplo A");
  assert.equal(a.question, "Quanto cada unidade do exemplo A vendeu?");
  assert.equal(a.source, "Planilha de exemplo A");
  assert.equal(a.updatedAt, "2026-10-30T10:00:00.000Z");
  assert.equal(a.available, true);
  assert.match(a.thumbnail, /^\/api\/d\/exemplo-a\/thumbnail\?v=\d+$/);
  // Sem carga concluída, a data é nula (a tela mostra "—"), e sem foto, o cartão fica sem imagem.
  assert.equal(b.updatedAt, null);
  assert.equal(b.thumbnail, null);
  assert.deepEqual(Object.keys(a).sort(), ["agent", "available", "name", "question", "slug", "source", "thumbnail", "updatedAt"]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Quem não tem o dashboard não o vê, e a recusa é igual à de um dashboard que não existe

test("sem login, nada do portal nem dos dashboards responde", async () => {
  for (const address of ["/api/dashboards", "/api/d/exemplo-a/dados", "/api/d/exemplo-a/info", "/api/d/exemplo-a/thumbnail", "/api/d/nao-existe/dados", "/api/admin/overview"]) {
    assert.equal((await main.get(address)).status, 401, address);
  }
  assert.equal((await main.call("POST", "/api/d/exemplo-a/agent", { body: { question: "Quanto?" } })).status, 401);
  assert.equal((await main.call("DELETE", "/api/d/exemplo-a/agent")).status, 401);
});

test("dashboard sem acesso: 404 byte a byte igual ao de um dashboard que não existe, em tudo", async () => {
  const withoutB = await main.login("um");
  const nobody = await main.login("nenhum");
  const request = async (slug: string, route: string, method: "GET" | "POST" | "DELETE", session: Session) => main.whole(await main.call(method, `/api/d/${slug}/${route}`, { session, body: method === "POST" ? { question: "Quanto?" } : undefined, token: session.csrf }));
  for (const [session, slug] of [[withoutB, "exemplo-b"], [nobody, "exemplo-a"], [nobody, "exemplo-b"]] as const) {
    for (const [route, method] of [["dados", "GET"], ["dados?ano=2024", "GET"], ["info", "GET"], ["thumbnail", "GET"], ["agent", "GET"], ["agent", "POST"], ["agent", "DELETE"], ["rota-que-nao-existe", "GET"], ["check", "GET"]] as const) {
      const real = await request(slug, route, method, session);
      const missing = await request("dashboard-que-nao-existe", route, method, session);
      assert.equal(real.status, 404, `${slug}/${route} ${method}`);
      assert.deepEqual(real, missing, `${slug}/${route} ${method}`);
      assert.doesNotMatch(real.body, /exemplo|Exemplo/);
    }
  }
  // O agente do dashboard sem acesso nem chega a consultar.
  const before = seen.length;
  await request("exemplo-b", "agent", "POST", withoutB);
  assert.equal(seen.length, before);
});

test("rota que não existe dentro de um dashboard permitido também é 404, e nome de propriedade do JavaScript não é rota", async () => {
  const session = await main.login("todas");
  for (const route of ["nao-existe", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const response = await main.whole(await main.get(`/api/d/exemplo-a/${route}`, session));
    assert.equal(response.status, 404, route);
    assert.deepEqual(response, await main.whole(await main.get("/api/d/dashboard-que-nao-existe/nao-existe", session)), route);
  }
  assert.equal((await main.get("/api/d/exemplo-a/dados/extra", session)).status, 404);
  assert.equal((await main.get("/api/d/exemplo-a", session)).status, 404);
});

test("miniatura: só serve a quem tem acesso àquele dashboard", async () => {
  const withA = await main.login("um");
  const image = await main.get("/api/d/exemplo-a/thumbnail", withA);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.match(image.headers.get("cache-control") ?? "", /private/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
  assert.equal((await main.get("/api/d/exemplo-a/thumbnail", await main.login("soB"))).status, 404, "tem outro dashboard, mas não este");
  assert.equal((await main.get("/api/d/exemplo-a/thumbnail", await main.login("nenhum"))).status, 404);
  assert.equal((await main.get("/api/d/exemplo-a/thumbnail", await main.login("chefe"))).status, 200);
  // Dashboard permitido, mas ainda sem foto: o cartão não pede, e pedir dá 404.
  assert.equal((await main.get("/api/d/exemplo-b/thumbnail", await main.login("todas"))).status, 404);
  // A foto aparece sem reiniciar, para quem tem acesso, e só para ele.
  writeFileSync(path.join(main.folder, "thumbs", "exemplo-b.png"), PNG);
  try {
    const [, b] = await main.cards(await main.login("todas"));
    assert.match(b.thumbnail, /^\/api\/d\/exemplo-b\/thumbnail\?v=\d+$/);
    assert.equal((await main.get("/api/d/exemplo-b/thumbnail", await main.login("soB"))).status, 200);
    assert.equal((await main.get("/api/d/exemplo-b/thumbnail", await main.login("um"))).status, 404);
  } finally {
    rmSync(path.join(main.folder, "thumbs", "exemplo-b.png"));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Limite do recorte dentro do dashboard

test("recorte: o que a pessoa pode ver chega à consulta, e o administrador e o acesso total recebem todos os itens", async () => {
  const rows = async (user: string, slug = "exemplo-a") => ((await main.json(await main.get(`/api/d/${slug}/dados`, await main.login(user)))).body.rows as { uf: string }[]).map((row) => row.uf);
  assert.deepEqual(await rows("um"), ["A1"]);
  assert.deepEqual(await rows("dois"), ["A1", "A3"]);
  assert.deepEqual(await rows("dois", "exemplo-b"), ["B2"]);
  assert.deepEqual(await rows("todas"), ["A1", "A2", "A3"]);
  assert.deepEqual(await rows("chefe"), ["A1", "A2", "A3"]);
  assert.deepEqual(await rows("chefe", "exemplo-b"), ["B1", "B2"]);
  // O mesmo número de itens de outro dashboard não vale para este: cada dashboard tem a sua lista.
  assert.deepEqual(seen.filter((s) => s.slug === "exemplo-b").at(-1)?.scope, ["B1", "B2"]);
  const info = async (user: string) => (await main.json(await main.get("/api/d/exemplo-a/info", await main.login(user)))).body.canCheck;
  assert.equal(await info("um"), false);
  assert.equal(await info("todas"), true);
  assert.equal(await info("chefe"), true);
});

test("recorte: um item listado que o dashboard não conhece não vale", async () => {
  await admin.query("INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) SELECT id, 'exemplo-a', 0, $1 FROM app_user WHERE login = 'nenhum'", [["A2", "ZZ"]]);
  try {
    assert.deepEqual(((await main.json(await main.get("/api/d/exemplo-a/dados", await main.login("nenhum")))).body.rows as { uf: string }[]).map((r) => r.uf), ["A2"]);
  } finally {
    await admin.query("DELETE FROM dashboard_access WHERE user_id = (SELECT id FROM app_user WHERE login = 'nenhum')");
  }
});

test("parâmetro desconhecido de um dashboard é 400, com a mensagem dele", async () => {
  const response = await main.json(await main.get("/api/d/exemplo-a/dados?xpto=1", await main.login("todas")));
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Filtro desconhecido/);
});

test("agente: responde com a permissão da sessão, pede o token CSRF e some para quem não tem o dashboard", async () => {
  const session = await main.login("dois");
  assert.deepEqual((await main.json(await main.get("/api/d/exemplo-a/agent", session))).body, { enabled: true, simulated: true, memory: { turns: 5, idleMinutes: 120 }, conversation: [] });
  const noToken = await main.call("POST", "/api/d/exemplo-a/agent", { session, body: { question: "Quanto?" } });
  assert.equal(noToken.status, 403);
  const answered = await main.json(await main.post("/api/d/exemplo-a/agent", { question: "Quanto?" }, session));
  assert.equal(answered.status, 200);
  assert.equal(answered.body.text, "Exemplo A: Quanto? (A1,A3)");
  assert.equal((await main.post("/api/d/exemplo-b/agent", { question: "Quanto?" }, await main.login("um"))).status, 404);
});

test("agente: só o dashboard que o declara no cartão tem a rota. Nos outros, a recusa é a de uma rota que não existe", async () => {
  // O exemplo B tem acesso liberado a esta pessoa, mas o cartão dele não declara agente.
  const session = await main.login("dois");
  assert.equal((await main.get("/api/d/exemplo-b/dados", session)).status, 200);
  const before = seen.length;
  for (const [method, address] of [["GET", "agent"], ["POST", "agent"], ["DELETE", "agent"]] as const) {
    const refused = await main.whole(await main.call(method, `/api/d/exemplo-b/${address}`, { session, body: method === "POST" ? { question: "Quanto?" } : undefined, token: session.csrf }));
    const missing = await main.whole(await main.call(method, "/api/d/exemplo-b/rota-que-nao-existe", { session, body: method === "POST" ? { question: "Quanto?" } : undefined, token: session.csrf }));
    assert.equal(refused.status, 404);
    assert.deepEqual(refused, missing);
  }
  assert.equal(seen.length, before);
  // O cartão diz qual tem agente, e o do exemplo A responde pela rota.
  const cards = (await main.json(await main.get("/api/dashboards", session))).body.dashboards as { slug: string; agent: boolean }[];
  assert.deepEqual(cards.map((card) => [card.slug, card.agent]), [["exemplo-a", true], ["exemplo-b", false]]);
  assert.equal((await main.json(await main.get("/api/d/exemplo-a/agent", session))).body.enabled, true);
});

test("agente: cada dashboard usa só a permissão de quem pergunta nele, e nunca consulta outro dashboard", async () => {
  const session = await main.login("um");
  const before = seen.length;
  const answered = await main.json(await main.post("/api/d/exemplo-a/agent", { question: "Quanto?" }, session));
  assert.equal(answered.body.text, "Exemplo A: Quanto? (A1)");
  // Só o dashboard perguntado foi tocado, com os itens que a pessoa tem nele.
  assert.deepEqual(seen.slice(before), [{ slug: "exemplo-a", route: "agent", scope: ["A1"] }]);
});

test("agente: se o cartão diz que tem agente e o dashboard não traz as ferramentas, o servidor não sobe", async () => {
  const folder = path.join(dir, "agente-faltando");
  mkdirSync(path.join(folder, "web"), { recursive: true });
  createSqliteFile(path.join(folder, "portal.sqlite"), { sql: PORTAL_SQL });
  process.env.DB_ENGINE = "sqlite";
  process.env.SQLITE_DIR = folder;
  const broken = { ...exemploB, card: { ...exemploB.card, agent: true } };
  await assert.rejects(
    createApp({ dashboards: [broken], authMode: "login", engine: "sqlite", host: "127.0.0.1", port: 0, cookieSecure: false, agentProvider: "simulado", model: null, agentLimitPerHour: 1000, env: {}, webDir: path.join(folder, "web"), dataDir: folder }),
    /diz ter agente no cartão/,
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Administração

test("administração: 401 sem login, 403 para quem não é administrador, e escrever pede o CSRF", async () => {
  assert.equal((await main.get("/api/admin/overview")).status, 401);
  assert.equal((await main.call("POST", "/api/admin/create-user", { body: { login: "x" } })).status, 401);
  for (const user of ["um", "todas", "nenhum"]) {
    const session = await main.login(user);
    assert.equal((await main.get("/api/admin/overview", session)).status, 403, user);
    for (const route of ["create-user", "set-access", "set-active", "reset-password", "qualquer-outra"]) {
      assert.equal((await main.post(`/api/admin/${route}`, { login: "teste_x", userId: "1", dashboard: "exemplo-a", mode: "all", active: false }, session)).status, 403, `${user} ${route}`);
    }
  }
  const boss = await main.login("chefe");
  assert.equal((await main.get("/api/admin/overview", boss)).status, 200);
  for (const [name, token] of [["sem token", undefined], ["token errado", "errado"]] as const) {
    const response = await main.call("POST", "/api/admin/create-user", { session: boss, body: { login: "semcsrf" }, token });
    assert.equal(response.status, 403, name);
  }
  // O token de outra sessão também não vale.
  const other = await main.login("chefe");
  assert.equal((await main.call("POST", "/api/admin/create-user", { session: boss, body: { login: "semcsrf" }, token: other.csrf })).status, 403);
  assert.deepEqual(await portalRows("SELECT login FROM app_user WHERE login = 'semcsrf'"), []);
});

test("administração: a visão geral lista pessoas, dashboards e recortes, sem hash nem sal", async () => {
  const overview = await main.json(await main.get("/api/admin/overview", await main.login("chefe")));
  assert.deepEqual(overview.body.dashboards.map((d: { slug: string }) => d.slug), ["exemplo-a", "exemplo-b"]);
  assert.deepEqual(overview.body.dashboards[1].scope.items, [{ code: "B1", name: "Delta" }, { code: "B2", name: "Épsilon" }]);
  const dois = overview.body.users.find((u: { login: string }) => u.login === "dois");
  assert.deepEqual(dois.access, { "exemplo-a": { full: false, codes: ["A1", "A3"] }, "exemplo-b": { full: false, codes: ["B2"] } });
  assert.equal(overview.body.users.find((u: { login: string }) => u.login === "chefe").isAdmin, true);
  assert.doesNotMatch(JSON.stringify(overview.body), /pass_hash|pass_salt|passHash/);
});

test("pessoa nova: senha provisória sorteada, guardada só em hash, começa sem nenhum dashboard e é obrigada a trocar", async () => {
  const boss = await main.login("chefe");
  const created = await main.json(await main.post("/api/admin/create-user", { login: "  nova  ", name: "Pessoa Nova" }, boss));
  assert.equal(created.status, 200);
  const provisional = created.body.password as string;
  assert.match(provisional, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  const [row] = await portalRows("SELECT * FROM app_user WHERE login = 'nova'");
  assert.equal(row.name, "Pessoa Nova");
  assert.equal(row.must_change_password, 1);
  assert.equal(row.is_admin, 0);
  assert.ok(!JSON.stringify(row).includes(provisional), "a senha não fica em texto no banco");
  assert.deepEqual(await portalRows("SELECT * FROM dashboard_access WHERE user_id = $1", [row.id]), [], "nenhum dashboard até o administrador marcar");
  // Duas pessoas criadas em seguida não recebem a mesma senha.
  const second = await main.json(await main.post("/api/admin/create-user", { login: "nova2" }, boss));
  assert.notEqual(second.body.password, provisional);
  // Usuário repetido, inválido ou fora do formato.
  for (const login of ["nova", "nova ", "", "   ", "a\nb", "<script>", "x".repeat(129), 123, null, ["nova"]]) {
    assert.equal((await main.post("/api/admin/create-user", { login }, boss)).status, 400, JSON.stringify(login));
  }

  // A provisória entra, mas só consegue trocar a senha.
  const fresh = await main.login("nova", provisional);
  const me = await main.json(await main.get("/api/me", fresh));
  assert.equal(me.body.mustChangePassword, true);
  for (const address of ["/api/dashboards", "/api/d/exemplo-a/info", "/api/d/exemplo-a/dados", "/api/d/exemplo-a/thumbnail", "/api/admin/overview", "/api/d/dashboard-que-nao-existe/info"]) {
    const response = await main.json(await main.get(address, fresh));
    assert.equal(response.status, 403, address);
    assert.match(response.body.error, /Troque a senha/);
  }
  assert.equal((await main.post("/api/d/exemplo-a/agent", { question: "Quanto?" }, fresh)).status, 403);
  assert.equal((await main.post("/api/admin/create-user", { login: "x" }, fresh)).status, 403);
  // Trocar: a nova precisa de 8 caracteres, ser diferente da atual e a atual precisa conferir.
  assert.equal((await main.post("/api/password", { current: provisional, next: "curta" }, fresh)).status, 400);
  assert.equal((await main.post("/api/password", { current: provisional, next: provisional }, fresh)).status, 400);
  assert.equal((await main.post("/api/password", { current: "errada", next: "uma-senha-nova-1" }, fresh)).status, 400);
  assert.equal((await main.post("/api/password", { current: 1, next: 2 }, fresh)).status, 400);
  assert.equal((await main.call("POST", "/api/password", { session: fresh, body: { current: provisional, next: "uma-senha-nova-1" } })).status, 403, "sem CSRF");
  assert.equal((await main.json(await main.get("/api/me", fresh))).body.mustChangePassword, true, "as tentativas recusadas não destravam");
  assert.equal((await main.post("/api/password", { current: provisional, next: "uma-senha-nova-1" }, fresh)).status, 200);

  // Depois da troca, a pessoa entra normalmente (sem nenhum dashboard), e a senha antiga deixou de valer.
  assert.equal((await main.json(await main.get("/api/me", fresh))).body.mustChangePassword, false);
  assert.deepEqual(await main.cards(fresh), []);
  assert.equal((await main.call("POST", "/api/login", { body: { login: "nova", password: provisional } })).status, 401);
  assert.equal((await main.call("POST", "/api/login", { body: { login: "nova", password: "uma-senha-nova-1" } })).status, 200);
});

test("troca de senha pela própria pessoa derruba as outras sessões dela, e só a dela", async () => {
  const first = await main.login("todas");
  const second = await main.login("todas");
  const other = await main.login("dois");
  assert.equal((await main.post("/api/password", { current: PASSWORD, next: "outra-senha-boa-2" }, first)).status, 200);
  assert.equal((await main.get("/api/dashboards", first)).status, 200);
  assert.equal((await main.get("/api/dashboards", second)).status, 401);
  assert.equal((await main.get("/api/dashboards", other)).status, 200);
  assert.equal((await main.post("/api/password", { current: "outra-senha-boa-2", next: PASSWORD }, first)).status, 200);
});

test("marcar dashboards e o recorte: tudo, só alguns itens e nenhum valem na hora; valor inválido é recusado", async () => {
  const boss = await main.login("chefe");
  const [{ id }] = await portalRows("SELECT id FROM app_user WHERE login = 'nenhum'");
  const set = (dashboard: unknown, mode: unknown, codes?: unknown, userId: unknown = String(id)) => main.post("/api/admin/set-access", { userId, dashboard, mode, codes }, boss);
  const person = await main.login("nenhum");
  const rows = async () => ((await main.json(await main.get("/api/d/exemplo-a/dados", person))).body.rows as { uf: string }[]).map((r) => r.uf);

  assert.equal((await set("exemplo-a", "some", ["A2"])).status, 200);
  assert.deepEqual((await main.cards(person)).map((c) => c.slug), ["exemplo-a"]);
  assert.deepEqual(await rows(), ["A2"]);
  assert.equal((await set("exemplo-a", "some", ["A3", "A1", "A3"])).status, 200, "trocar a lista");
  assert.deepEqual(await rows(), ["A1", "A3"]);
  assert.deepEqual((await portalRows("SELECT state_codes FROM dashboard_access WHERE user_id = $1", [id])).map((r) => r.state_codes), ['["A1","A3"]'], "sem repetição, em ordem");
  assert.equal((await set("exemplo-a", "all")).status, 200);
  assert.deepEqual(await rows(), ["A1", "A2", "A3"]);
  assert.equal((await set("exemplo-b", "all")).status, 200);
  assert.deepEqual((await main.cards(person)).map((c) => c.slug), ["exemplo-a", "exemplo-b"]);
  assert.equal((await set("exemplo-a", "none")).status, 200);
  assert.deepEqual((await main.cards(person)).map((c) => c.slug), ["exemplo-b"]);
  assert.equal((await main.get("/api/d/exemplo-a/dados", person)).status, 404, "tirar o acesso vale na hora, com a sessão que já existia");
  assert.equal((await set("exemplo-b", "none")).status, 200);
  assert.deepEqual(await main.cards(person), []);
  assert.deepEqual(await portalRows("SELECT * FROM dashboard_access WHERE user_id = $1", [id]), []);

  // Recusas: o que não for uma escolha clara não grava nada.
  for (const [dashboard, mode, codes] of [
    ["exemplo-a", "some", []], ["exemplo-a", "some", ["ZZ"]], ["exemplo-a", "some", ["B1"]], ["exemplo-a", "some", [1]], ["exemplo-a", "some", "A1"], ["exemplo-a", "some", undefined], ["exemplo-a", "states", ["A1"]],
    ["exemplo-a", "qualquer", ["A1"]], ["exemplo-a", undefined, undefined], ["nao-existe", "all", undefined], [undefined, "all", undefined], ["constructor", "all", undefined],
  ] as const) {
    assert.equal((await set(dashboard, mode, codes)).status, 400, JSON.stringify([dashboard, mode, codes]));
  }
  for (const userId of ["999999", "abc", "", 7, null, "1; DROP TABLE app_user"]) assert.equal((await set("exemplo-a", "all", undefined, userId)).status, 400, JSON.stringify(userId));
  assert.deepEqual(await portalRows("SELECT * FROM dashboard_access WHERE user_id = $1", [id]), []);
});

test("o administrador não é alterado pela tela: nem acesso, nem desativação, nem redefinição de senha", async () => {
  const boss = await main.login("chefe");
  const [{ id }] = await portalRows("SELECT id FROM app_user WHERE login = 'chefe'");
  assert.equal((await main.post("/api/admin/set-access", { userId: String(id), dashboard: "exemplo-a", mode: "none" }, boss)).status, 400);
  assert.equal((await main.post("/api/admin/set-active", { userId: String(id), active: false }, boss)).status, 400);
  assert.equal((await main.post("/api/admin/reset-password", { userId: String(id) }, boss)).status, 400);
  assert.equal((await main.get("/api/dashboards", boss)).status, 200, "a sessão continua");
  assert.equal((await portalRows("SELECT active FROM app_user WHERE id = $1", [id]))[0].active, 1);
});

test("desativar derruba as sessões e impede de entrar, com a mesma resposta de senha errada; reativar devolve a entrada", async () => {
  const boss = await main.login("chefe");
  const [{ id }] = await portalRows("SELECT id FROM app_user WHERE login = 'soB'");
  const open = await main.login("soB");
  assert.equal((await main.get("/api/dashboards", open)).status, 200);
  assert.equal((await main.post("/api/admin/set-active", { userId: String(id), active: false }, boss)).status, 200);
  assert.equal((await main.get("/api/dashboards", open)).status, 401, "a sessão que já existia caiu");
  assert.deepEqual(await portalRows("SELECT 1 FROM app_session WHERE user_id = $1", [id]), []);
  const off = await main.whole(await main.call("POST", "/api/login", { body: { login: "soB", password: PASSWORD } }));
  assert.equal(off.status, 401);
  assert.deepEqual(off, await main.whole(await main.call("POST", "/api/login", { body: { login: "soB", password: "errada" } })));
  assert.equal((await main.json(await main.get("/api/admin/overview", boss))).body.users.find((u: { login: string }) => u.login === "soB").active, false);
  assert.equal((await main.post("/api/admin/set-active", { userId: String(id), active: "sim" }, boss)).status, 400);
  assert.equal((await main.post("/api/admin/set-active", { userId: String(id), active: true }, boss)).status, 200);
  const back = await main.login("soB");
  assert.deepEqual((await main.cards(back)).map((c) => c.slug), ["exemplo-b"], "o acesso que tinha continua");
});

test("redefinir a senha encerra as sessões, gera outra provisória e exige nova troca", async () => {
  const boss = await main.login("chefe");
  const [{ id }] = await portalRows("SELECT id FROM app_user WHERE login = 'dois'");
  const open = await main.login("dois");
  const reset = await main.json(await main.post("/api/admin/reset-password", { userId: String(id) }, boss));
  assert.equal(reset.status, 200);
  assert.match(reset.body.password, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  assert.equal((await main.get("/api/dashboards", open)).status, 401);
  assert.equal((await main.call("POST", "/api/login", { body: { login: "dois", password: PASSWORD } })).status, 401, "a senha antiga deixou de valer");
  const again = await main.login("dois", reset.body.password);
  assert.equal((await main.get("/api/dashboards", again)).status, 403, "provisória: só a troca de senha");
  assert.ok(!JSON.stringify(await portalRows("SELECT * FROM app_user WHERE login = 'dois'")).includes(reset.body.password));
  assert.equal((await main.post("/api/password", { current: reset.body.password, next: PASSWORD }, again)).status, 200);
  assert.deepEqual((await main.cards(again)).map((c) => c.slug), ["exemplo-a", "exemplo-b"], "o acesso marcado continua");
});

test("sessão: logout pede o CSRF, e vencida não vale", async () => {
  const session = await main.login("um");
  assert.equal((await main.call("POST", "/api/logout", { session, body: {} })).status, 403);
  assert.equal((await main.get("/api/dashboards", session)).status, 200);
  await admin.query("UPDATE app_session SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token = $1", [session.cookie.split("=")[1]]);
  assert.equal((await main.get("/api/dashboards", session)).status, 401);
  const fresh = await main.login("um");
  assert.equal((await main.post("/api/logout", {}, fresh)).status, 200);
  assert.equal((await main.get("/api/dashboards", fresh)).status, 401);
});

// ---------------------------------------------------------------------------------------------------------------------
// Outros modos

test("AUTH_MODE=local: sem login, todos os dashboards inteiros, e nenhuma rota de administração", async () => {
  const local = await project("local", { authMode: "local" });
  try {
    assert.deepEqual((await local.cards(null as never)).map((c) => c.slug), ["exemplo-a", "exemplo-b"]);
    assert.deepEqual((await local.json(await local.get("/api/d/exemplo-b/dados"))).body.rows, [{ uf: "B1", valor: 100 }, { uf: "B2", valor: 200 }]);
    assert.deepEqual(((await local.json(await local.get("/api/me"))).body), { mode: "local", user: null, csrf: null, mustChangePassword: false });
    for (const address of ["/api/admin/overview", "/api/admin/users"]) assert.equal((await local.get(address)).status, 403, address);
    for (const route of ["create-user", "set-access", "set-active", "reset-password"]) assert.equal((await local.call("POST", `/api/admin/${route}`, { body: { login: "x", userId: "1", dashboard: "exemplo-a", mode: "all" } })).status, 403, route);
    assert.equal((await local.call("POST", "/api/login", { body: { login: "a", password: "b" } })).status, 400, "este modo não tem login");
    assert.equal((await local.call("POST", "/api/password", { body: { current: "a", next: "bbbbbbbb" } })).status, 400);
  } finally {
    await local.close();
  }
});

test("primeiro login: sem nenhuma pessoa, só nesta máquina; a criada vira administradora e vê tudo", async () => {
  const empty = await project("vazio", { host: "0.0.0.0" });
  try {
    assert.equal(empty.app.listeningHost, "127.0.0.1", "sem nenhuma pessoa, não escuta na rede, mesmo com HOST=0.0.0.0");
    assert.equal((await empty.json(await empty.get("/api/me"))).body.firstLogin, "here");
    // Atrás de um proxy, a criação é recusada.
    const proxied = await fetch(`${empty.base}/api/first-login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "8.8.8.8" }, body: JSON.stringify({ login: "dono", password: PASSWORD }) });
    assert.equal(proxied.status, 403);
    assert.equal((await empty.call("POST", "/api/first-login", { body: { login: "dono", password: "curta" } })).status, 400);
    const created = await empty.json(await empty.call("POST", "/api/first-login", { body: { login: "dono", password: PASSWORD } }));
    assert.equal(created.status, 200);
    assert.deepEqual(created.body.user, { name: "dono", isAdmin: true });
    assert.equal(created.body.mustChangePassword, false);
    assert.equal((await empty.call("POST", "/api/first-login", { body: { login: "outro", password: PASSWORD } })).status, 409);
    const boss = await empty.login("dono");
    assert.deepEqual((await empty.cards(boss)).map((c) => c.slug), ["exemplo-a", "exemplo-b"]);
    assert.equal((await empty.get("/api/admin/overview", boss)).status, 200);
    assert.equal((await empty.json(await empty.get("/api/me"))).body.firstLogin, undefined);
  } finally {
    await empty.close();
  }
  // Com pessoas na tabela, escuta no HOST configurado.
  const full = await project("com-gente", { host: "0.0.0.0", listen: false, seed: (portal) => seedUsers(portal, [{ login: "chefe", admin: true }]) });
  try {
    assert.equal(full.app.listeningHost, "0.0.0.0");
  } finally {
    await full.close();
  }
});

test("a entrada é do projeto: nenhuma resposta antes do login cita o nome de um dashboard", async () => {
  const anonymous = [
    await main.whole(await main.get("/")),
    await main.whole(await main.get("/me-perdi")),
    await main.whole(await main.get("/api/me")),
    await main.whole(await main.call("POST", "/api/login", { body: { login: "ninguem", password: "errada-errada" } })),
    await main.whole(await main.get("/api/dashboards")),
    await main.whole(await main.get("/api/d/exemplo-a/dados")),
  ];
  for (const response of anonymous) assert.doesNotMatch(`${response.body}`, /exemplo|Exemplo/);
  // Logada, a pessoa vê os nomes só onde eles são dados: na lista de cartões.
  const session = await main.login("todas");
  assert.match((await main.json(await main.get("/api/me", session))).body.user.name, /^todas$/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Memória da conversa do agente

const MEMORY_USERS: Seed[] = [
  { login: "ana", access: { "exemplo-a": ["A1"], "exemplo-c": "todas" } },
  { login: "bia", access: { "exemplo-a": ["A1"], "exemplo-c": "todas" } },
  { login: "caio", access: { "exemplo-a": ["A1"] } },
  { login: "dora", access: { "exemplo-a": ["A1"] } },
  { login: "eva", access: { "exemplo-a": ["A1"] } },
  { login: "chefe", admin: true },
];

let memo: Project;
let memoAdmin: ReturnType<typeof openSqlite>;

// Os projetos de teste leem o ambiente ao subir: este sobe depois do principal, no mesmo gancho, nunca ao mesmo tempo.
async function startMemo() {
  memo = await project("memoria", {
    seed: (portal) => seedUsers(portal, MEMORY_USERS),
    dashboards: [exemploA, exemploC],
    agentMemory: { turns: 3, idleMinutes: 120, maxConversations: 200, maxChars: 20_000 },
  });
  memoAdmin = openSqlite(path.join(memo.folder, "portal.sqlite"), null);
}

/** Pergunta pela rota do agente e devolve a conversa que o agente recebeu como contexto. */
async function askAgent(project: Project, session: Session | undefined, slug: string, question: string, extra: Record<string, unknown> = {}) {
  const before = asked.length;
  const response = await project.json(await project.post(`/api/d/${slug}/agent`, { question, ...extra }, session));
  assert.equal(response.status, 200, question);
  assert.equal(asked.length, before + 1);
  return { response, history: asked[before].history.map((turn) => turn.question), context: asked[before] };
}

const stored = async (project: Project, session: Session, slug: string) =>
  (await project.json(await project.get(`/api/d/${slug}/agent`, session))).body;

test("memória: cada pergunta recebe as trocas anteriores da mesma pessoa no mesmo dashboard, e só elas", async () => {
  const ana = await memo.login("ana");
  const bia = await memo.login("bia");
  assert.deepEqual((await askAgent(memo, ana, "exemplo-a", "um")).history, []);
  assert.deepEqual((await askAgent(memo, ana, "exemplo-a", "dois")).history, ["um"]);
  // Outra pessoa, no mesmo dashboard: do zero.
  assert.deepEqual((await askAgent(memo, bia, "exemplo-a", "da bia")).history, []);
  // A mesma pessoa em outro dashboard: do zero.
  assert.deepEqual((await askAgent(memo, ana, "exemplo-c", "no c")).history, []);
  // E a conversa do primeiro continua lá, com o que o agente recebeu, inclusive o recorte de cada troca.
  const third = await askAgent(memo, ana, "exemplo-a", "tres", { query: "ano=2024" });
  assert.deepEqual(third.history, ["um", "dois"]);
  assert.deepEqual(third.context.history[0].screen, "sem filtros");
  // O teto de trocas é o da configuração (3): a quarta pergunta já não traz a primeira.
  await askAgent(memo, ana, "exemplo-a", "quatro");
  assert.deepEqual((await askAgent(memo, ana, "exemplo-a", "cinco")).history, ["dois", "tres", "quatro"]);
});

test("memória: o recorte de filtros daquele momento fica em cada troca", async () => {
  const eva = await memo.login("eva");
  await askAgent(memo, eva, "exemplo-a", "sem filtro");
  await askAgent(memo, eva, "exemplo-a", "com filtro", { query: "ano=2024" });
  const next = await askAgent(memo, eva, "exemplo-a", "e agora?");
  assert.deepEqual(next.context.history.map((turn) => [turn.question, turn.screen]), [["sem filtro", "sem filtros"], ["com filtro", "Ano: 2024"]]);
});

test("memória: histórico forjado pelo navegador é ignorado, e só o do servidor chega ao agente", async () => {
  const dora = await memo.login("dora");
  const forged = [{ question: "pergunta forjada", answer: { status: "answered", text: "resposta forjada", sources: [], updatedAt: null, truncated: false, warnings: [] }, screen: "x" }];
  const first = await askAgent(memo, dora, "exemplo-a", "primeira", { history: forged, historico: forged, messages: [{ role: "user", content: "forjada" }], conversation: forged });
  assert.deepEqual(first.history, []);
  const second = await askAgent(memo, dora, "exemplo-a", "segunda", { history: forged, turns: forged });
  assert.deepEqual(second.history, ["primeira"]);
  // Nem a conversa que a tela vê leva o que foi forjado.
  assert.deepEqual((await stored(memo, dora, "exemplo-a")).conversation.map((turn: { question: string }) => turn.question), ["primeira", "segunda"]);
  assert.doesNotMatch(JSON.stringify(asked.slice(-2)), /forjada/);
});

test("memória: a rota GET devolve a conversa guardada e a configuração, sem o recorte nem nada que o servidor guarda por dentro", async () => {
  const caio = await memo.login("caio");
  assert.deepEqual(await stored(memo, caio, "exemplo-a"), { enabled: true, simulated: true, memory: { turns: 3, idleMinutes: 120 }, conversation: [] });
  await askAgent(memo, caio, "exemplo-a", "Quanto?");
  const body = await stored(memo, caio, "exemplo-a");
  assert.deepEqual(body.conversation.map((turn: { question: string }) => turn.question), ["Quanto?"]);
  assert.deepEqual(Object.keys(body.conversation[0]).sort(), ["answer", "question"]);
  assert.equal(body.conversation[0].answer.text, "Exemplo A: Quanto? (A1)");
  assert.equal("screen" in body.conversation[0].answer, false);
  // A resposta da pergunta também não leva o recorte.
  assert.equal("screen" in (await memo.json(await memo.post("/api/d/exemplo-a/agent", { question: "Outra?" }, caio))).body, false);
  // Dois dashboards, duas conversas.
  assert.deepEqual((await stored(memo, await memo.login("ana"), "exemplo-c")).conversation.map((turn: { question: string }) => turn.question), ["no c"]);
});

test("Nova conversa: a rota DELETE exige o token CSRF e só esquece a conversa de quem pede, naquele dashboard", async () => {
  const ana = await memo.login("ana");
  const bia = await memo.login("bia");
  await askAgent(memo, ana, "exemplo-a", "para esquecer");
  await askAgent(memo, ana, "exemplo-c", "para guardar");
  await askAgent(memo, bia, "exemplo-a", "da bia de novo");
  assert.equal((await memo.call("DELETE", "/api/d/exemplo-a/agent")).status, 401);
  assert.equal((await memo.call("DELETE", "/api/d/exemplo-a/agent", { session: ana })).status, 403);
  assert.equal((await memo.call("DELETE", "/api/d/exemplo-a/agent", { session: ana, token: "errado" })).status, 403);
  assert.ok((await stored(memo, ana, "exemplo-a")).conversation.length > 0);
  const deleted = await memo.json(await memo.call("DELETE", "/api/d/exemplo-a/agent", { session: ana, token: ana.csrf }));
  assert.deepEqual([deleted.status, deleted.body], [200, { ok: true }]);
  assert.deepEqual((await stored(memo, ana, "exemplo-a")).conversation, []);
  assert.deepEqual((await askAgent(memo, ana, "exemplo-a", "recomeço")).history, []);
  // As conversas dos outros ficam.
  assert.ok((await stored(memo, ana, "exemplo-c")).conversation.length > 0);
  assert.ok((await stored(memo, bia, "exemplo-a")).conversation.length > 0);
});

test("Nova conversa: dashboard sem acesso ou sem agente recusa o DELETE como uma rota que não existe", async () => {
  const caio = await memo.login("caio"); // sem acesso ao C
  const answers = async (slug: string) => memo.whole(await memo.call("DELETE", `/api/d/${slug}/agent`, { session: caio, token: caio.csrf }));
  const missing = await answers("dashboard-que-nao-existe");
  assert.equal(missing.status, 404);
  assert.deepEqual(await answers("exemplo-c"), missing);
  // O A tem acesso e responde.
  assert.equal((await answers("exemplo-a")).status, 200);
});

test("memória: sair apaga as conversas da pessoa, em todos os dashboards, e não as dos outros", async () => {
  const ana = await memo.login("ana");
  const bia = await memo.login("bia");
  await askAgent(memo, ana, "exemplo-a", "antes de sair");
  await askAgent(memo, ana, "exemplo-c", "antes de sair, no c");
  await askAgent(memo, bia, "exemplo-a", "bia fica");
  assert.equal((await memo.post("/api/logout", {}, ana)).status, 200);
  const again = await memo.login("ana");
  assert.deepEqual((await stored(memo, again, "exemplo-a")).conversation, []);
  assert.deepEqual((await stored(memo, again, "exemplo-c")).conversation, []);
  assert.deepEqual((await askAgent(memo, again, "exemplo-a", "depois de voltar")).history, []);
  assert.ok((await stored(memo, bia, "exemplo-a")).conversation.some((turn: { question: string }) => turn.question === "bia fica"));
});

test("memória: se a permissão da pessoa no dashboard muda, a conversa começa do zero", async () => {
  const session = await memo.login("dora");
  await memo.post("/api/d/exemplo-a/agent", { question: "x" }, session);
  assert.ok((await stored(memo, session, "exemplo-a")).conversation.length > 0);
  const { rows } = await memoAdmin.query("SELECT id FROM app_user WHERE login = $1", ["dora"]);
  await memoAdmin.query("UPDATE dashboard_access SET state_codes = $1 WHERE user_id = $2 AND dashboard = 'exemplo-a'", [["A1", "A2"], rows[0].id]);
  assert.deepEqual((await stored(memo, session, "exemplo-a")).conversation, []);
  assert.deepEqual((await askAgent(memo, session, "exemplo-a", "com a permissão nova")).history, []);
  // Voltar à permissão antiga não traz a conversa antiga de volta.
  await memoAdmin.query("UPDATE dashboard_access SET state_codes = $1 WHERE user_id = $2 AND dashboard = 'exemplo-a'", [["A1"], rows[0].id]);
  assert.deepEqual((await stored(memo, session, "exemplo-a")).conversation, []);
  // Acesso total é outra permissão que "A1".
  await memoAdmin.query("UPDATE dashboard_access SET full_access = TRUE WHERE user_id = $1 AND dashboard = 'exemplo-a'", [rows[0].id]);
  assert.deepEqual((await askAgent(memo, session, "exemplo-a", "com tudo")).history, []);
  await memoAdmin.query("UPDATE dashboard_access SET full_access = FALSE WHERE user_id = $1 AND dashboard = 'exemplo-a'", [rows[0].id]);
});

test("memória: o teto de conversas guardadas descarta a usada há mais tempo, e o de trocas corta as mais antigas", async () => {
  const small = await project("memoria-teto", {
    seed: (portal) => seedUsers(portal, MEMORY_USERS),
    dashboards: [exemploA, exemploC],
    agentMemory: { turns: 2, idleMinutes: 120, maxConversations: 2, maxChars: 20_000 },
  });
  try {
    const [ana, bia, caio] = [await small.login("ana"), await small.login("bia"), await small.login("caio")];
    await askAgent(small, ana, "exemplo-a", "ana 1");
    await askAgent(small, bia, "exemplo-a", "bia 1");
    await askAgent(small, caio, "exemplo-a", "caio 1"); // passou do teto: sai a da ana, que é a mais antiga
    assert.deepEqual((await stored(small, ana, "exemplo-a")).conversation, []);
    assert.equal((await stored(small, bia, "exemplo-a")).conversation.length, 1);
    assert.equal((await stored(small, caio, "exemplo-a")).conversation.length, 1);
    await askAgent(small, caio, "exemplo-a", "caio 2");
    await askAgent(small, caio, "exemplo-a", "caio 3");
    assert.deepEqual((await askAgent(small, caio, "exemplo-a", "caio 4")).history, ["caio 2", "caio 3"]);
  } finally {
    await small.close();
  }
});

test("memória: sem login, a conversa é a de \"local\", e Nova conversa a esquece", async () => {
  const local = await project("memoria-local", { authMode: "local", dashboards: [exemploA, exemploC], agentMemory: { turns: 5, idleMinutes: 120, maxConversations: 200, maxChars: 20_000 } });
  try {
    assert.deepEqual((await askAgent(local, undefined, "exemplo-a", "primeira")).history, []);
    assert.deepEqual((await askAgent(local, undefined, "exemplo-a", "segunda")).history, ["primeira"]);
    assert.deepEqual((await askAgent(local, undefined, "exemplo-c", "no c")).history, []);
    assert.equal((await local.call("DELETE", "/api/d/exemplo-a/agent")).status, 200);
    assert.deepEqual((await askAgent(local, undefined, "exemplo-a", "recomeço")).history, []);
  } finally {
    await local.close();
  }
});

test("memória: a pergunta vazia ou grande demais não entra na conversa", async () => {
  const eva = await memo.login("eva");
  await memo.call("DELETE", "/api/d/exemplo-a/agent", { session: eva, token: eva.csrf });
  await memo.post("/api/d/exemplo-a/agent", { question: "   " }, eva);
  await memo.post("/api/d/exemplo-a/agent", { question: "x".repeat(501) }, eva);
  assert.deepEqual((await stored(memo, eva, "exemplo-a")).conversation, []);
  await memo.post("/api/d/exemplo-a/agent", { question: "valida" }, eva);
  assert.deepEqual((await stored(memo, eva, "exemplo-a")).conversation.map((turn: { question: string }) => turn.question), ["valida"]);
});

test("memória: nada da conversa vai para o registro nem para o banco do portal", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    const bia = await memo.login("bia");
    await memo.post("/api/d/exemplo-a/agent", { question: "texto secreto da pergunta" }, bia);
  } finally {
    console.log = original;
  }
  assert.ok(lines.some((line) => line.includes('"event":"agent"')));
  assert.ok(lines.every((line) => !line.includes("texto secreto")));
  for (const table of ["app_user", "app_session", "dashboard_access"]) {
    assert.doesNotMatch(JSON.stringify(await memoAdmin.query(`SELECT * FROM ${table}`).then((result) => result.rows)), /texto secreto/);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Recorte opcional e com nome próprio

const CUT_USERS: Seed[] = [
  { login: "chefe", admin: true },
  { login: "plena", access: { "exemplo-a": "todas", "exemplo-b": "todas", "exemplo-c": "todas", "exemplo-d": "todas" } },
  { login: "soD", access: { "exemplo-d": "todas" } },
  // Uma linha parcial antiga num dashboard que não tem recorte: não vale como acesso.
  { login: "parcialD", access: { "exemplo-d": ["X"] } },
  { login: "semNada" },
  // Como o create-user antigo gravava: o mesmo código repetido.
  { login: "repetida", access: { "exemplo-a": ["A1", "A1", "A1"] } },
  { login: "umTalhao", access: { "exemplo-c": ["C1"] } },
  { login: "nenhumTalhao", access: { "exemplo-c": [] } },
];

let cut: Project;
let cutAdmin: ReturnType<typeof openSqlite>;
const cutSessions = new Map<string, Session>();
/** Uma entrada por pessoa: o servidor limita as tentativas de login por endereço, e este arquivo faz muitas. */
async function cutLogin(user: string) {
  const known = cutSessions.get(user);
  if (known) return known;
  const entered = await cut.login(user);
  cutSessions.set(user, entered);
  return entered;
}

async function startCut() {
  cut = await project("recorte", { seed: (portal) => seedUsers(portal, CUT_USERS), dashboards: [exemploA, exemploB, exemploC, exemploD] });
  cutAdmin = openSqlite(path.join(cut.folder, "portal.sqlite"), null);
  // O D tem foto, para a recusa da miniatura não ser só "não há arquivo".
  mkdirSync(path.join(cut.folder, "thumbs"), { recursive: true });
  writeFileSync(path.join(cut.folder, "thumbs", "exemplo-d.png"), PNG);
}

const cutAdminCall = async (route: string, body: unknown) => cut.json(await cut.post(`/api/admin/${route}`, body, await cutLogin("chefe")));
const cutId = async (login: string) => String((await cutAdmin.query("SELECT id FROM app_user WHERE login = $1", [login])).rows[0].id);

test("sem recorte: o acesso é com ou sem, a rota recebe sempre [], e a visão geral traz scope nulo", async () => {
  const before = seen.length;
  const data = await cut.json(await cut.get("/api/d/exemplo-d/dados", await cutLogin("soD")));
  assert.deepEqual([data.status, data.body], [200, { rows: [{ valor: 7 }], total: 7 }]);
  assert.deepEqual(seen.slice(before), [{ slug: "exemplo-d", route: "dados", scope: [] }]);
  // O administrador e o acesso total também recebem [], nunca a lista de um recorte que não existe.
  await cut.get("/api/d/exemplo-d/dados", await cutLogin("chefe"));
  await cut.get("/api/d/exemplo-d/dados", await cutLogin("plena"));
  assert.deepEqual(seen.slice(before).map((s) => s.scope), [[], [], []]);
  assert.equal((await cut.json(await cut.get("/api/d/exemplo-d/info", await cutLogin("soD")))).body.canCheck, true);

  const overview = (await cut.json(await cut.get("/api/admin/overview", await cutLogin("chefe")))).body;
  const bySlug = Object.fromEntries(overview.dashboards.map((d: { slug: string }) => [d.slug, d]));
  assert.equal(bySlug["exemplo-d"].scope, null);
  assert.equal(bySlug["exemplo-b"].scope.label.singular, "fazenda");
  assert.equal(bySlug["exemplo-c"].scope.label.gender, "m");
  const user = (login: string) => overview.users.find((u: { login: string }) => u.login === login);
  assert.deepEqual(user("soD").access, { "exemplo-d": { full: true, codes: [] } });
  assert.deepEqual(user("parcialD").access, {}, "a linha parcial antiga não aparece como acesso: a administração mostra Sem acesso");
  // A linha continua guardada, sem apagar nada às escondidas.
  assert.equal((await cutAdmin.query("SELECT 1 FROM dashboard_access WHERE user_id = $1 AND dashboard = 'exemplo-d'", [await cutId("parcialD")])).rows.length, 1);
});

test("sem recorte: set-access aceita só none e all; escolher itens dá 400 e não grava nada", async () => {
  const id = await cutId("semNada");
  const set = (mode: unknown, codes?: unknown) => cutAdminCall("set-access", { userId: id, dashboard: "exemplo-d", mode, codes });
  for (const [mode, codes] of [["some", ["A1"]], ["some", []], ["some", undefined], ["states", ["A1"]], ["qualquer", undefined]] as const) {
    const refused = await set(mode, codes);
    assert.deepEqual([refused.status, refused.body.error], [400, "Este dashboard não tem recorte: escolha com ou sem acesso."], JSON.stringify([mode, codes]));
  }
  assert.deepEqual((await cutAdmin.query("SELECT * FROM dashboard_access WHERE user_id = $1", [id])).rows, []);
  assert.equal((await set("all")).status, 200);
  assert.deepEqual(JSON.stringify((await cutAdmin.query("SELECT full_access, state_codes FROM dashboard_access WHERE user_id = $1", [id])).rows), '[{"full_access":1,"state_codes":"[]"}]');
  assert.equal((await set("none")).status, 200);
  assert.deepEqual((await cutAdmin.query("SELECT * FROM dashboard_access WHERE user_id = $1", [id])).rows, []);
});

test("sem recorte: o atalho de categoria dá e tira o acesso ao dashboard", async () => {
  const id = await cutId("semNada");
  const created = await cutAdminCall("create-category", { name: "Sem recorte" });
  assert.equal(created.status, 200);
  const category = created.body.id as string;
  assert.equal((await cutAdminCall("set-dashboard-category", { dashboard: "exemplo-d", categoryId: category })).status, 200);
  assert.equal((await cutAdminCall("set-category-access", { userId: id, categoryId: category, mode: "all" })).status, 200);
  const person = await cutLogin("semNada");
  assert.deepEqual((await cut.cards(person)).map((card) => card.slug), ["exemplo-d"]);
  assert.equal((await cut.get("/api/d/exemplo-d/dados", person)).status, 200);
  assert.equal((await cutAdminCall("set-category-access", { userId: id, categoryId: category, mode: "none" })).status, 200);
  assert.deepEqual(await cut.cards(person), []);
  assert.equal((await cut.get("/api/d/exemplo-d/dados", person)).status, 404);
  await cutAdminCall("set-dashboard-category", { dashboard: "exemplo-d", categoryId: null });
  await cutAdminCall("delete-category", { id: category });
});

test("sem recorte: o agente responde sem nota de permissão, e com recorte parcial a nota existe e concorda em gênero", async () => {
  const full = await cut.json(await cut.post("/api/d/exemplo-d/agent", { question: "Quanto?" }, await cutLogin("soD")));
  assert.equal(full.status, 200);
  assert.equal(full.body.text, "Exemplo D: Quanto? ()");
  assert.doesNotMatch(full.body.text, /Permissão|pode ver/);
  // O mesmo mecanismo, num dashboard com recorte e a pessoa limitada, traz a nota.
  const limited = await cut.json(await cut.post("/api/d/exemplo-c/agent", { question: "Quanto?" }, await cutLogin("umTalhao")));
  assert.match(limited.body.text, /só pode ver estes talhões: Ômega\. Nunca ofereça, sugira nem cite outros/);
  // Sem nenhum talhão, o gênero concorda: "nenhum".
  const none = await cut.json(await cut.post("/api/d/exemplo-c/agent", { question: "Quanto?" }, await cutLogin("nenhumTalhao")));
  assert.match(none.body.text, /estes talhões: nenhum\./);
  // Acesso total ao recorte não leva nota.
  assert.doesNotMatch((await cut.json(await cut.post("/api/d/exemplo-c/agent", { question: "Quanto?" }, await cutLogin("plena")))).body.text, /pode ver/);
});

test("sem recorte: sem linha de acesso e com linha parcial antiga, a recusa é byte a byte a de um dashboard que não existe", async () => {
  const request = async (slug: string, route: string, method: "GET" | "POST" | "DELETE", session: Session) =>
    cut.whole(await cut.call(method, `/api/d/${slug}/${route}`, { session, body: method === "POST" ? { question: "Quanto?" } : undefined, token: session.csrf }));
  const before = seen.length;
  for (const user of ["semNada", "parcialD"]) {
    const session = await cutLogin(user);
    for (const [route, method] of [["dados", "GET"], ["dados?ano=2024", "GET"], ["info", "GET"], ["thumbnail", "GET"], ["agent", "GET"], ["agent", "POST"], ["agent", "DELETE"], ["check", "GET"]] as const) {
      const real = await request("exemplo-d", route, method, session);
      const missing = await request("dashboard-que-nao-existe", route, method, session);
      assert.equal(real.status, 404, `${user} ${route} ${method}`);
      assert.deepEqual(real, missing, `${user} ${route} ${method}`);
    }
    assert.deepEqual((await cut.cards(session)).map((card) => card.slug), [], user);
  }
  assert.equal(seen.length, before, "nenhuma consulta nem o agente foi tocado");
});

test("rótulo próprio: as mensagens do servidor concordam com o gênero do recorte", async () => {
  const id = await cutId("semNada");
  const set = (dashboard: string, codes: unknown) => cutAdminCall("set-access", { userId: id, dashboard, mode: "some", codes });
  const message = async (dashboard: string, codes: unknown) => (await set(dashboard, codes)).body.error;
  assert.equal(await message("exemplo-b", []), "Escolha ao menos uma fazenda.");
  assert.equal(await message("exemplo-b", ["ZZ"]), "Fazenda inválida.");
  assert.equal(await message("exemplo-c", []), "Escolha ao menos um talhão.");
  assert.equal(await message("exemplo-c", ["ZZ"]), "Talhão inválido.");
  assert.equal(await message("exemplo-a", ["ZZ"]), "Unidade inválida.");
  assert.deepEqual((await cutAdmin.query("SELECT * FROM dashboard_access WHERE user_id = $1", [id])).rows, []);
});

test("repetidos: o mesmo código várias vezes não vira acesso total, no canCheck nem no agente", async () => {
  const session = await cutLogin("repetida");
  const before = seen.length;
  const info = await cut.json(await cut.get("/api/d/exemplo-a/info", session));
  assert.equal(info.body.canCheck, false, "A1 três vezes num recorte de três não é total");
  const data = await cut.json(await cut.get("/api/d/exemplo-a/dados", session));
  assert.deepEqual((data.body.rows as { uf: string }[]).map((row) => row.uf), ["A1"]);
  const answered = await cut.json(await cut.post("/api/d/exemplo-a/agent", { question: "Quanto?" }, session));
  assert.equal(answered.body.text, "Exemplo A: Quanto? (A1)");
  assert.deepEqual(seen.slice(before).map((s) => s.scope), [["A1"], ["A1"]]);
  // A mesma regra vale para a administração, que mostra um item só.
  const overview = (await cut.json(await cut.get("/api/admin/overview", await cutLogin("chefe")))).body;
  assert.deepEqual(overview.users.find((u: { login: string }) => u.login === "repetida").access, { "exemplo-a": { full: false, codes: ["A1"] } });
});
