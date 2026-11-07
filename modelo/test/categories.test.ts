// Categorias de dashboards: definidas na administração, atalho de acesso por categoria e seções no painel só com mais de uma categoria.
// O servidor de verdade, em-processo, com dois dashboards de exemplo e um SQLite temporário só para o portal; e o mesmo conjunto de regras no Postgres
// descartável, com os usuários de banco do portal (login só lê, administração grava, dashboards não enxergam). Sem rede nem dado real.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import pg from "pg";
import { createAdmin } from "../server/admin.ts";
import { createApp } from "../server/app.ts";
import { createCategories, UNCATEGORIZED } from "../server/categories.ts";
import { hashPassword } from "../server/auth.ts";
import { DASHBOARDS } from "../server/dashboards.ts";
import { createSqliteFile, openSqlite } from "../server/db/sqlite.ts";
import type { Db } from "../server/db/types.ts";
import { BadRequest } from "../server/errors.ts";
import { exemploA, exemploB } from "./fixtures/dashboards.ts";

const dir = mkdtempSync(path.join(tmpdir(), "dash-categories-test-"));
const PASSWORD = "senha-de-teste-1";
const { hash, salt } = hashPassword(PASSWORD);

type Session = { csrf: string; cookie: string };
type Sqlite = ReturnType<typeof openSqlite>;

let app: Awaited<ReturnType<typeof createApp>>;
let base = "";
let portal: Sqlite;

const call = (method: string, address: string, { session, body, token }: { session?: { cookie: string }; body?: unknown; token?: string } = {}) =>
  fetch(base + address, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(session ? { cookie: session.cookie } : {}), ...(token ? { "X-CSRF-Token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (address: string, session?: Session) => call("GET", address, { session });
const post = (address: string, body: unknown, session?: Session) => call("POST", address, { session, body, token: session?.csrf });
const sessions = new Map<string, Session>();
/** Uma entrada por pessoa: o servidor limita as tentativas de login por endereço. */
async function login(user: string): Promise<Session> {
  const known = sessions.get(user);
  if (known) return known;
  const entered = await enter(user);
  sessions.set(user, entered);
  return entered;
}
async function enter(user: string): Promise<Session> {
  const response = await call("POST", "/api/login", { body: { login: user, password: PASSWORD } });
  assert.equal(response.status, 200, `login de ${user}`);
  const { csrf } = (await response.json()) as { csrf: string };
  return { csrf, cookie: response.headers.get("set-cookie")!.split(";")[0] };
}
const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, any> });

type Seed = { login: string; admin?: boolean; access?: Record<string, "todas" | string[]> };
const USERS: Seed[] = [
  { login: "chefe", admin: true },
  { login: "ambos", access: { "exemplo-a": "todas", "exemplo-b": "todas" } },
  { login: "soA", access: { "exemplo-a": ["A1"] } },
  { login: "soB", access: { "exemplo-b": ["B1"] } },
  { login: "nenhum" },
  { login: "alvo" },
];

before(async () => {
  const folder = path.join(dir, "principal");
  mkdirSync(path.join(folder, "web"), { recursive: true });
  writeFileSync(path.join(folder, "web", "index.html"), "<!doctype html><title>Painel</title>");
  createSqliteFile(path.join(folder, "portal.sqlite"), { sql: ["server/sql/sqlite_portal_schema.sql"] });
  portal = openSqlite(path.join(folder, "portal.sqlite"), null);
  for (const user of USERS) {
    const { rows } = await portal.query("INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin, active, must_change_password) VALUES ($1, $1, $2, $3, $4, 1, 0) RETURNING id", [user.login, hash, salt, user.admin === true]);
    for (const [slug, access] of Object.entries(user.access ?? {})) {
      await portal.query("INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, $2, $3, $4)", [rows[0].id, slug, access === "todas", access === "todas" ? [] : access]);
    }
  }
  process.env.DB_ENGINE = "sqlite";
  process.env.SQLITE_DIR = folder;
  app = await createApp({
    dashboards: [exemploA, exemploB], authMode: "login", engine: "sqlite", host: "127.0.0.1", port: 0, cookieSecure: false, agentProvider: "simulado", model: null,
    agentLimitPerHour: 1000, env: {}, webDir: path.join(folder, "web"), dataDir: folder,
  });
  base = `http://127.0.0.1:${await app.listen()}`;
}, { timeout: 60_000 });

after(async () => {
  await portal?.end();
  await app?.close();
});

const rows = (sql: string, values: unknown[] = []) => portal.query(sql, values).then((r) => r.rows);
const adminCall = async (route: string, body: unknown) => json(await post(`/api/admin/${route}`, body, await login("chefe")));
const access = async (user: string) => Object.fromEntries((await rows("SELECT a.dashboard, a.full_access, a.state_codes FROM dashboard_access a JOIN app_user u ON u.id = a.user_id WHERE u.login = $1 ORDER BY a.dashboard", [user])).map((r) => [r.dashboard, `${r.full_access ? "total" : "parcial"}:${r.state_codes}`]));
const userId = async (login: string) => String((await rows("SELECT id FROM app_user WHERE login = $1", [login]))[0].id);
const overview = async () => (await json(await get("/api/admin/overview", await login("chefe")))).body as { dashboards: { slug: string; categoryId: string | null }[]; categories: { id: string; name: string }[] };

// ---------------------------------------------------------------------------------------------------------------------

test("só o administrador chega às rotas de categoria, e escrever pede o CSRF", async () => {
  const routes: [string, unknown][] = [
    ["create-category", { name: "Qualquer" }], ["rename-category", { id: "1", name: "Outra" }], ["move-category", { id: "1", direction: "up" }], ["delete-category", { id: "1" }],
    ["set-dashboard-category", { dashboard: "exemplo-a", categoryId: null }], ["set-category-access", { userId: "1", categoryId: "1", mode: "all" }],
  ];
  for (const route of routes) assert.equal((await call("POST", `/api/admin/${route[0]}`, { body: route[1] })).status, 401, `${route[0]} sem login`);
  for (const user of ["ambos", "soA", "nenhum"]) {
    const session = await login(user);
    for (const [route, body] of routes) assert.equal((await post(`/api/admin/${route}`, body, session)).status, 403, `${user} ${route}`);
  }
  const boss = await login("chefe");
  for (const [route, body] of routes) assert.equal((await call("POST", `/api/admin/${route}`, { session: boss, body })).status, 403, `${route} sem token`);
  assert.deepEqual(await rows("SELECT * FROM category"), [], "nada foi criado");
});

test("nome da categoria: sem espaços nas pontas, tamanho limitado, sem caractere de controle, único sem diferenciar maiúscula, e nunca o de Sem categoria", async () => {
  const created = await adminCall("create-category", { name: "  Produção  " });
  assert.equal(created.status, 200);
  assert.deepEqual((await rows("SELECT name FROM category")).map((r) => r.name), ["Produção"], "as pontas saem");
  for (const [name, pattern] of [
    ["", /1 a 40/], ["   ", /1 a 40/], ["x".repeat(41), /1 a 40/], ["com\ncontrole", /1 a 40/], ["produção", /Já existe/], ["PRODUÇÃO", /Já existe/], ["Sem categoria", /Sem categoria/], ["sem CATEGORIA", /Sem categoria/],
  ] as const) {
    const refused = await adminCall("create-category", { name });
    assert.equal(refused.status, 400, JSON.stringify(name));
    assert.match(refused.body.error, pattern, JSON.stringify(name));
  }
  for (const name of [123, null, undefined, ["a"], { a: 1 }]) assert.equal((await adminCall("create-category", { name })).status, 400);
  assert.equal((await adminCall("create-category", { name: "x".repeat(40) })).status, 200, "40 caracteres cabem");
  await adminCall("delete-category", { id: String((await rows("SELECT id FROM category WHERE name = $1", ["x".repeat(40)]))[0].id) });
  assert.equal((await rows("SELECT * FROM category")).length, 1);
});

test("categorias: criar, renomear, ordenar e apagar só vazia, com a ordem sempre definida pela administração", async () => {
  const teste = (await adminCall("create-category", { name: "Teste" })).body.id as string;
  const extra = (await adminCall("create-category", { name: "Extra" })).body.id as string;
  const names = async () => (await overview()).categories.map((c) => c.name);
  assert.deepEqual(await names(), ["Produção", "Teste", "Extra"]);
  // Subir e descer trocam com a vizinha; nas pontas, nada acontece.
  await adminCall("move-category", { id: extra, direction: "up" });
  assert.deepEqual(await names(), ["Produção", "Extra", "Teste"]);
  await adminCall("move-category", { id: extra, direction: "up" });
  await adminCall("move-category", { id: extra, direction: "up" });
  assert.deepEqual(await names(), ["Extra", "Produção", "Teste"]);
  await adminCall("move-category", { id: extra, direction: "down" });
  assert.deepEqual(await names(), ["Produção", "Extra", "Teste"]);
  assert.equal((await adminCall("move-category", { id: extra, direction: "lado" })).status, 400);
  assert.equal((await adminCall("move-category", { id: "999", direction: "up" })).status, 400);
  // Renomear: o mesmo nome em outra caixa vale para a própria categoria, mas não para outra.
  assert.equal((await adminCall("rename-category", { id: extra, name: "EXTRA" })).status, 200);
  assert.equal((await adminCall("rename-category", { id: extra, name: "teste" })).status, 400);
  assert.equal((await adminCall("rename-category", { id: extra, name: " Reserva " })).status, 200);
  assert.deepEqual(await names(), ["Produção", "Reserva", "Teste"]);
  // Só se apaga categoria vazia.
  await adminCall("set-dashboard-category", { dashboard: "exemplo-b", categoryId: teste });
  const refused = await adminCall("delete-category", { id: teste });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /sem dashboards/);
  assert.equal((await adminCall("delete-category", { id: extra })).status, 200);
  assert.deepEqual(await names(), ["Produção", "Teste"]);
  assert.equal((await adminCall("delete-category", { id: extra })).status, 400, "já foi apagada");
  for (const id of [1, null, "abc", "1; DROP TABLE category"]) assert.equal((await adminCall("delete-category", { id })).status, 400);
});

test("dashboard em uma categoria: o slug precisa existir no registro, a categoria também, e sem categoria vai para Sem categoria", async () => {
  const ids = Object.fromEntries((await overview()).categories.map((c) => [c.name, c.id]));
  assert.equal((await adminCall("set-dashboard-category", { dashboard: "nao-existe", categoryId: ids["Produção"] })).status, 400);
  assert.equal((await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: "999" })).status, 400);
  assert.equal((await adminCall("set-dashboard-category", { dashboard: "constructor", categoryId: null })).status, 400);
  assert.equal((await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: ids["Produção"] })).status, 200);
  assert.deepEqual((await overview()).dashboards.map((d) => [d.slug, d.categoryId]), [["exemplo-a", ids["Produção"]], ["exemplo-b", ids["Teste"]]]);
  assert.equal((await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: ids["Teste"] })).status, 200, "trocar de categoria");
  assert.equal((await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: null })).status, 200);
  assert.equal((await overview()).dashboards[0].categoryId, null);
  await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: ids["Produção"] });
});

test("atalho por categoria: dá acesso total a cada dashboard dela, um acesso por dashboard, e desmarcar tira só esses", async () => {
  const { categories } = await overview();
  const producao = categories.find((c) => c.name === "Produção")!.id;
  const teste = categories.find((c) => c.name === "Teste")!.id;
  const alvo = await userId("alvo");
  // Um dashboard já com recorte parcial: o atalho dá acesso total, trocando o recorte.
  await portal.query("INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, 'exemplo-a', 0, $2)", [alvo, ["A1"]]);
  assert.equal((await adminCall("set-category-access", { userId: alvo, categoryId: producao, mode: "all" })).status, 200);
  assert.deepEqual(await access("alvo"), { "exemplo-a": "total:[]" });
  assert.equal((await adminCall("set-category-access", { userId: alvo, categoryId: teste, mode: "all" })).status, 200);
  assert.deepEqual(await access("alvo"), { "exemplo-a": "total:[]", "exemplo-b": "total:[]" });
  // Desmarcar uma categoria tira os dashboards dela e deixa os da outra.
  assert.equal((await adminCall("set-category-access", { userId: alvo, categoryId: producao, mode: "none" })).status, 200);
  assert.deepEqual(await access("alvo"), { "exemplo-b": "total:[]" });
  // Repetir não muda nada.
  await adminCall("set-category-access", { userId: alvo, categoryId: teste, mode: "all" });
  assert.deepEqual(await access("alvo"), { "exemplo-b": "total:[]" });
  // Dashboard que entra na categoria depois não aparece sozinho.
  await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: teste });
  assert.deepEqual(await access("alvo"), { "exemplo-b": "total:[]" }, "mudar a categoria não muda o acesso de ninguém");
  assert.deepEqual((await get("/api/dashboards", await login("alvo")).then(json)).body.dashboards.map((c: { slug: string }) => c.slug), ["exemplo-b"]);
  await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: producao });
  // Os acessos de outras pessoas não mudam.
  assert.deepEqual(await access("soA"), { "exemplo-a": "parcial:[\"A1\"]" });
  assert.deepEqual(await access("ambos"), { "exemplo-a": "total:[]", "exemplo-b": "total:[]" });
  await portal.query("DELETE FROM dashboard_access WHERE user_id = $1", [alvo]);
});

test("atalho por categoria: recusa pessoa administradora, pessoa que não existe, categoria inválida e modo inválido", async () => {
  const { categories } = await overview();
  const producao = categories[0].id;
  assert.equal((await adminCall("set-category-access", { userId: await userId("chefe"), categoryId: producao, mode: "all" })).status, 400, "o administrador não é alterado");
  for (const body of [
    { userId: "99999", categoryId: producao, mode: "all" }, { userId: await userId("alvo"), categoryId: "999", mode: "all" }, { userId: await userId("alvo"), categoryId: producao, mode: "some" },
    { userId: await userId("alvo"), categoryId: producao, mode: "none; DROP" }, { userId: "x", categoryId: producao, mode: "all" }, { userId: await userId("alvo"), categoryId: 1, mode: "all" },
  ]) assert.equal((await adminCall("set-category-access", body)).status, 400, JSON.stringify(body));
  assert.deepEqual(await access("alvo"), {});
});

test("painel: seções só com mais de uma categoria, na ordem definida, e Sem categoria por último", async () => {
  const sections = async (user: string) => (await json(await get("/api/dashboards", await login(user)))).body as { dashboards: { slug: string }[]; sections: { id: string | null; name: string; slugs: string[]; title: boolean }[] };
  // Duas categorias à vista: com título, na ordem da administração (Produção primeiro).
  const both = await sections("ambos");
  assert.deepEqual(both.sections.map((s) => [s.name, s.slugs, s.title]), [["Produção", ["exemplo-a"], true], ["Teste", ["exemplo-b"], true]]);
  assert.deepEqual(both.dashboards.map((d) => d.slug), ["exemplo-a", "exemplo-b"]);
  assert.deepEqual((await sections("chefe")).sections.map((s) => s.name), ["Produção", "Teste"]);
  // Uma categoria só: o portal fica como sempre foi, sem título.
  assert.deepEqual((await sections("soA")).sections.map((s) => [s.name, s.title]), [["Produção", false]]);
  // A ordem muda quando a administração muda.
  const { categories } = await overview();
  const teste = categories.find((c) => c.name === "Teste")!.id;
  await adminCall("move-category", { id: teste, direction: "up" });
  assert.deepEqual((await sections("ambos")).sections.map((s) => s.name), ["Teste", "Produção"]);
  assert.deepEqual((await sections("ambos")).dashboards.map((d) => d.slug), ["exemplo-b", "exemplo-a"], "os cartões seguem a ordem das seções");
  await adminCall("move-category", { id: teste, direction: "down" });
  // Dashboard sem categoria: seção Sem categoria, por último, e só com título quando há mais de uma seção.
  await adminCall("set-dashboard-category", { dashboard: "exemplo-b", categoryId: null });
  assert.deepEqual((await sections("ambos")).sections.map((s) => [s.name, s.id, s.title]), [["Produção", categories[0].id, true], [UNCATEGORIZED, null, true]]);
  assert.deepEqual((await sections("soB")).sections.map((s) => [s.name, s.title]), [[UNCATEGORIZED, false]], "sozinha, sem título");
  await adminCall("set-dashboard-category", { dashboard: "exemplo-b", categoryId: teste });
});

test("uma categoria sem dashboard visível não aparece, e o nome dela não vaza em nenhuma resposta da pessoa", async () => {
  const secret = (await adminCall("create-category", { name: "Reservado interno" })).body.id as string;
  await adminCall("set-dashboard-category", { dashboard: "exemplo-b", categoryId: secret });
  try {
    for (const user of ["soA", "nenhum"]) {
      const session = await login(user);
      const answers = [
        await (await get("/api/dashboards", session)).text(), await (await get("/api/me", session)).text(), await (await get("/api/d/exemplo-a/info", session)).text(),
        await (await get("/api/d/exemplo-b/info", session)).text(), await (await get("/api/d/exemplo-b/dados", session)).text(), await (await get("/api/admin/overview", session)).text(),
      ];
      for (const text of answers) assert.doesNotMatch(text, /Reservado|Teste interno/i, user);
    }
    // Quem vê o dashboard recebe o nome dele na lista e no selo.
    assert.deepEqual((await json(await get("/api/dashboards", await login("soB")))).body.sections.map((s: { name: string }) => s.name), ["Reservado interno"]);
    assert.equal((await json(await get("/api/d/exemplo-b/info", await login("soB")))).body.category, "Reservado interno");
    // A pessoa sem o dashboard recebe a mesma recusa de um dashboard que não existe, sem nenhuma categoria.
    const refused = await (await get("/api/d/exemplo-b/info", await login("soA"))).text();
    assert.equal(refused, await (await get("/api/d/nao-existe/info", await login("soA"))).text());
  } finally {
    await adminCall("set-dashboard-category", { dashboard: "exemplo-b", categoryId: (await overview()).categories.find((c) => c.name === "Teste")!.id });
    await adminCall("delete-category", { id: secret });
  }
});

test("selo dentro do dashboard: o nome da categoria vem do info, e vira nulo sem categoria", async () => {
  const info = async (slug: string) => (await json(await get(`/api/d/${slug}/info`, await login("ambos")))).body;
  assert.equal((await info("exemplo-a")).category, "Produção");
  assert.equal((await info("exemplo-b")).category, "Teste");
  assert.equal((await info("exemplo-a")).canCheck, true, "o resto do info continua igual");
  await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: null });
  assert.equal((await info("exemplo-a")).category, null);
  await adminCall("set-dashboard-category", { dashboard: "exemplo-a", categoryId: (await overview()).categories.find((c) => c.name === "Produção")!.id });
});

test("os arquivos de atualização do banco que já existe podem ser repetidos sem perder nada", async () => {
  const before = await rows("SELECT count(*) AS n FROM app_user");
  const handle = portal.handle();
  handle.exec(readFileSync("server/sql/sqlite_portal_upgrade_categories.sql", "utf8"));
  handle.exec(readFileSync("server/sql/sqlite_portal_upgrade_categories.sql", "utf8"));
  assert.deepEqual(await rows("SELECT count(*) AS n FROM app_user"), before);
  assert.equal((await rows("SELECT count(*) AS n FROM category"))[0].n, 2, "as categorias existentes continuam");
});

// ---------------------------------------------------------------------------------------------------------------------
// Postgres: os mesmos comportamentos, e o que cada usuário de banco pode tocar

let pgAdmin: pg.Client | null = null;
let pgStop: (() => Promise<void>) | null = null;
let pgSkip = "";
const pgPools: pg.Pool[] = [];
const pgConfig: { port: number; passwords: Record<string, string> } = { port: 0, passwords: {} };

const freePort = () => new Promise<number>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});

const pgPool = (role: string, schema = "portal") => {
  const pool = new pg.Pool({ host: "127.0.0.1", port: pgConfig.port, user: role, password: pgConfig.passwords[role], database: "cat", options: `-c search_path=${schema}`, max: 3 });
  pgPools.push(pool);
  return pool as unknown as Db;
};

before(async () => {
  try {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    pgConfig.port = await freePort();
    const password = randomBytes(12).toString("hex");
    const server = new EmbeddedPostgres({ databaseDir: path.join(dir, "postgres"), user: "teste", password, port: pgConfig.port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase("cat");
    pgAdmin = new pg.Client({ host: "127.0.0.1", port: pgConfig.port, user: "teste", password, database: "cat" });
    await pgAdmin.connect();
    for (const role of ["dash_auth", "dash_portal"]) {
      pgConfig.passwords[role] = randomBytes(12).toString("hex");
      await pgAdmin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${pgConfig.passwords[role]}'`);
    }
    await pgAdmin.query("CREATE SCHEMA portal");
    await pgAdmin.query("SET search_path = portal");
    for (const file of ["portal_schema.sql", "portal_grants.sql"]) await pgAdmin.query(readFileSync(`server/sql/${file}`, "utf8"));
    // Os dashboards reais, para provar que o leitor de nenhum deles enxerga as tabelas novas do portal.
    for (const dashboard of DASHBOARDS) {
      const db = dashboard.db;
      await pgAdmin.query(`CREATE SCHEMA ${db.schema}`);
      await pgAdmin.query(`SET search_path = ${db.schema}`);
      await pgAdmin.query(readFileSync(`dashboards/${dashboard.slug}/sql/001_schema.sql`, "utf8"));
      for (const role of [`${db.schema}_reader`, `${db.schema}_loader`]) {
        pgConfig.passwords[role] = randomBytes(12).toString("hex");
        await pgAdmin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${pgConfig.passwords[role]}'`);
      }
      await pgAdmin.query(readFileSync(`dashboards/${dashboard.slug}/sql/002_grants.sql`, "utf8"));
    }
    await pgAdmin.query("RESET search_path");
    pgStop = async () => {
      await Promise.allSettled(pgPools.map((pool) => pool.end()));
      await pgAdmin?.end();
      await server.stop();
    };
  } catch (error) {
    pgSkip = `o Postgres descartável não subiu: ${error instanceof Error ? error.message : error}`;
  }
}, { timeout: 120_000 });

after(async () => {
  await pgStop?.();
  // Por último: a pasta do Postgres descartável está dentro dela.
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const needsPostgres = (name: string, body: () => Promise<void>) => test(name, async (t) => {
  if (pgSkip) return t.skip(pgSkip);
  await body();
});
const DENIED = /permission denied/;

needsPostgres("Postgres: as regras de categoria e de atalho são as mesmas, pela conexão da administração", async () => {
  const writer = pgPool("dash_portal");
  const admin = createAdmin(writer, [exemploA, exemploB]);
  await pgAdmin!.query("INSERT INTO portal.app_user (login, name, pass_hash, pass_salt) VALUES ('alvo', 'alvo', 'x', 'x'), ('chefe', 'chefe', 'x', 'x')");
  await pgAdmin!.query("UPDATE portal.app_user SET is_admin = TRUE WHERE login = 'chefe'");
  const alvo = String((await pgAdmin!.query("SELECT id FROM portal.app_user WHERE login = 'alvo'")).rows[0].id);
  const chefe = String((await pgAdmin!.query("SELECT id FROM portal.app_user WHERE login = 'chefe'")).rows[0].id);

  const producao = (await admin.createCategory("  Produção ")).id;
  const teste = (await admin.createCategory("Teste")).id;
  await assert.rejects(admin.createCategory("produção"), BadRequest);
  await assert.rejects(admin.createCategory("Sem categoria"), BadRequest);
  await assert.rejects(admin.createCategory("x".repeat(41)), BadRequest);
  await admin.moveCategory(teste, "up");
  assert.deepEqual((await admin.catalog()).categories.map((c) => c.name), ["Teste", "Produção"]);
  await admin.moveCategory(teste, "down");
  await admin.renameCategory(teste, "TESTE");
  await assert.rejects(admin.renameCategory(teste, "produção"), BadRequest);
  await admin.setDashboardCategory("exemplo-a", producao);
  await admin.setDashboardCategory("exemplo-b", teste);
  await assert.rejects(admin.setDashboardCategory("nao-existe", producao), BadRequest);
  await assert.rejects(admin.deleteCategory(producao), /sem dashboards/);

  await admin.setAccess(alvo, "exemplo-a", "some", ["A1"]);
  await admin.setCategoryAccess(alvo, producao, "all");
  await admin.setCategoryAccess(alvo, teste, "all");
  const has = async () => (await pgAdmin!.query("SELECT dashboard, full_access FROM portal.dashboard_access WHERE user_id = $1 ORDER BY dashboard", [alvo])).rows.map((r) => `${r.dashboard}:${r.full_access}`);
  assert.deepEqual(await has(), ["exemplo-a:true", "exemplo-b:true"]);
  await admin.setCategoryAccess(alvo, producao, "none");
  assert.deepEqual(await has(), ["exemplo-b:true"]);
  await assert.rejects(admin.setCategoryAccess(chefe, producao, "all"), BadRequest);
  await assert.rejects(admin.setCategoryAccess(alvo, producao, "some"), BadRequest);

  // O painel, pela conexão de login: seções só com mais de uma categoria visível, e o que não é visível não sai.
  const reader = createCategories(pgPool("dash_auth"));
  const both = await reader.place(["exemplo-a", "exemplo-b"]);
  assert.deepEqual(both.categories.map((c) => [c.name, c.slugs]), [["Produção", ["exemplo-a"]], ["TESTE", ["exemplo-b"]]]);
  const onlyB = await reader.place(["exemplo-b"]);
  assert.deepEqual(onlyB.categories.map((c) => c.name), ["TESTE"]);
  assert.doesNotMatch(JSON.stringify(onlyB), /Produção/, "a categoria de um dashboard que a pessoa não vê não sai");
  await admin.setDashboardCategory("exemplo-b", null);
  assert.deepEqual((await reader.place(["exemplo-b"])).uncategorized, ["exemplo-b"]);
  assert.equal(await reader.nameOf("exemplo-b"), null);
  await admin.setDashboardCategory("exemplo-b", teste);
});

needsPostgres("Postgres: só a administração grava nas tabelas de categoria; o login só lê; os dashboards não enxergam", async () => {
  const login = pgPool("dash_auth");
  const portalDb = pgPool("dash_portal");
  assert.ok((await login.query("SELECT * FROM category")).rows.length >= 0);
  assert.ok((await login.query("SELECT * FROM dashboard_category")).rows.length >= 0);
  for (const sql of ["INSERT INTO category (name, position) VALUES ('x', 9)", "UPDATE category SET name = 'x'", "DELETE FROM category", "INSERT INTO dashboard_category (dashboard, category_id) VALUES ('x', 1)", "DELETE FROM dashboard_category", "DROP TABLE category"]) {
    await assert.rejects(login.query(sql), /permission denied|must be owner/, `login: ${sql}`);
  }
  await portalDb.query("INSERT INTO category (name, position) VALUES ('Provisória', 99)");
  await portalDb.query("DELETE FROM category WHERE name = 'Provisória'");
  await assert.rejects(portalDb.query("DROP TABLE category"), /must be owner|permission denied/);
  await assert.rejects(portalDb.query("CREATE TABLE intruso (id int)"), /permission denied/);
  for (const dashboard of DASHBOARDS) {
    const reader = pgPool(`${dashboard.db.schema}_reader`, dashboard.db.schema);
    const loader = pgPool(`${dashboard.db.schema}_loader`, dashboard.db.schema);
    for (const [name, connection] of [["consulta", reader], ["carga", loader]] as const) {
      for (const sql of ["SELECT * FROM portal.category", "SELECT * FROM portal.dashboard_category", "INSERT INTO portal.category (name, position) VALUES ('x', 1)", "DELETE FROM portal.dashboard_category"]) {
        await assert.rejects(connection.query(sql), DENIED, `${dashboard.slug} (${name}): ${sql}`);
      }
    }
  }
});

needsPostgres("Postgres: o arquivo de atualização do banco que já existe pode ser repetido sem perder categorias nem acessos", async () => {
  const before = (await pgAdmin!.query("SELECT (SELECT count(*) FROM portal.category)::int AS categories, (SELECT count(*) FROM portal.dashboard_access)::int AS access, (SELECT count(*) FROM portal.app_user)::int AS users")).rows[0];
  await pgAdmin!.query("SET search_path = portal");
  const upgrade = readFileSync("server/sql/portal_upgrade_categories.sql", "utf8");
  await pgAdmin!.query(upgrade);
  await pgAdmin!.query(upgrade);
  await pgAdmin!.query("RESET search_path");
  const after = (await pgAdmin!.query("SELECT (SELECT count(*) FROM portal.category)::int AS categories, (SELECT count(*) FROM portal.dashboard_access)::int AS access, (SELECT count(*) FROM portal.app_user)::int AS users")).rows[0];
  assert.deepEqual(after, before);
  // Em um banco antigo, sem as tabelas, o arquivo as cria e dá as mesmas permissões.
  await pgAdmin!.query("CREATE SCHEMA antigo");
  await pgAdmin!.query("GRANT USAGE ON SCHEMA antigo TO dash_portal");
  await pgAdmin!.query("SET search_path = antigo");
  await pgAdmin!.query(readFileSync("server/sql/portal_schema.sql", "utf8").split("-- Categorias de dashboards")[0]);
  await pgAdmin!.query("INSERT INTO antigo.app_user (login, name, pass_hash, pass_salt) VALUES ('antiga', 'a', 'x', 'x')");
  await pgAdmin!.query(upgrade.replaceAll("category_id_seq", "category_id_seq"));
  const antigo = pgPool("dash_portal", "antigo");
  await antigo.query("INSERT INTO category (name, position) VALUES ('Nova', 1)");
  assert.equal((await pgAdmin!.query("SELECT count(*)::int AS n FROM antigo.app_user")).rows[0].n, 1, "a pessoa antiga continua");
  await pgAdmin!.query("RESET search_path");
});
