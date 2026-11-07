// Prova o portal com login: sobe o servidor em outra porta, com pessoas temporárias (teste_*), e apaga-as ao final.
// Rode com o banco de desenvolvimento no ar (ou com DB_ENGINE=sqlite e os arquivos criados por npm run db).
// A parte que depende dos dados de um dashboard fica na pasta dele: npm run dash -- check-login <slug>.
import assert from "node:assert/strict";
import pg from "pg";
import { atLeastOne, invalidItem } from "../shared/scope.ts";
import { validateDashboards } from "../server/dashboard.ts";
import { DASHBOARDS } from "../server/dashboards.ts";
import { openAuth, openAdmin, readEngine } from "../server/db/open.ts";
import { fixture, sqlite } from "./lib/portal-fixture.ts";

if (process.env.DASHBOARD_URL) console.log("DASHBOARD_URL é ignorada: esta prova sobe o próprio servidor.");
const PORT = "8788";
const [first] = DASHBOARDS;
validateDashboards(DASHBOARDS);
// O acesso parcial é provado no primeiro dashboard que tem recorte. Sem nenhum, essa parte é pulada, com aviso.
const scoped = DASHBOARDS.find((d) => d.scope);
const target = scoped ?? first;
const firstCode = scoped?.scope?.items[0].code;

// Com algum usuário na tabela, o primeiro login não cria mais nada. No SQLite, test/first-login.test.ts prova o mesmo.
const admin = await openAdmin("portal");
await admin.query("DELETE FROM app_user WHERE login LIKE 'teste_%'");
await admin.end();
const fx = await fixture([
  { login: "teste_admin", admin: true },
  { login: "teste_um", access: { [target.slug]: firstCode ? [firstCode] : "todas" } },
  { login: "teste_total", access: Object.fromEntries(DASHBOARDS.map((d) => [d.slug, "todas" as const])) },
  { login: "teste_nenhum" },
  { login: "teste_inativo", active: false, access: { [first.slug]: "todas" } },
  { login: "teste_prov", provisional: true, access: { [first.slug]: "todas" } },
], PORT);

const { get, post, postAs, login, base } = fx;
const json = async (response: Response) => ({ status: response.status, body: await response.json() as Record<string, any> });
const MISSING = "/api/d/dashboard-que-nao-existe";

try {
  // O primeiro login não cria mais nada com pessoas na tabela.
  if (!sqlite()) {
    const auth = await openAuth();
    const { rows } = await auth.query("SELECT portal.create_first_user('teste_invasor', 'x', 'x', 'x') AS created");
    assert.equal(rows[0].created, false);
    assert.equal((await fx.portal.query("SELECT 1 FROM app_user WHERE login = 'teste_invasor'")).rows.length, 0);
    console.log("OK, com usuários na tabela, o primeiro login não cria mais nada.");

    // Tabela temporária com o mesmo nome não pode desviar a função, que roda com o poder do dono dela.
    const attacker = new pg.Client({ connectionString: process.env.AUTH_DATABASE_URL });
    await attacker.connect();
    await attacker.query("CREATE TEMP TABLE app_user (id BIGINT, login TEXT, name TEXT, pass_hash TEXT, pass_salt TEXT, is_admin BOOLEAN, active BOOLEAN, must_change_password BOOLEAN, created_at TIMESTAMPTZ)");
    await attacker.query("CREATE FUNCTION pg_temp.desvio() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'desviada'; END $$");
    await attacker.query("CREATE TRIGGER desvio BEFORE INSERT ON pg_temp.app_user FOR EACH ROW EXECUTE FUNCTION pg_temp.desvio()");
    const attacked = await attacker.query("SELECT portal.create_first_user('teste_invasor', 'x', 'x', 'x') AS created");
    assert.equal(attacked.rows[0].created, false);
    await attacker.end();
    await auth.end();
    console.log("OK, tabela temporária não desvia a função do primeiro login.");
  }

  // Sem login, nada responde.
  for (const d of DASHBOARDS) assert.equal((await get(`/api/d/${d.slug}/info`)).status, 401, d.slug);
  assert.equal((await get("/api/dashboards")).status, 401);
  assert.equal((await get("/api/admin/overview")).status, 401);
  assert.equal((await post("/api/d/" + first.slug + "/agent", { question: "Quanto?" })).status, 401);
  assert.equal((await get(`/api/d/${first.slug}/thumbnail`)).status, 401);
  console.log("OK, sem login nenhuma rota do portal nem de dashboard responde.");

  assert.equal((await post("/api/login", { login: "teste_um", password: "errada" })).status, 401);
  assert.equal((await post("/api/login", { login: "nao_existe", password: "errada" })).status, 401);
  assert.equal((await post("/api/login", { login: "teste_inativo", password: fx.password })).status, 401);
  assert.deepEqual(await json(await post("/api/login", { login: "teste_inativo", password: fx.password })), await json(await post("/api/login", { login: "teste_um", password: "errada" })));
  console.log("OK, senha errada, usuário inexistente e pessoa desativada recebem a mesma resposta.");

  // Cartões só dos dashboards permitidos.
  const one = await login("teste_um");
  const total = await login("teste_total");
  const boss = await login("teste_admin");
  const none = await login("teste_nenhum");
  const cards = async (session: { cookie: string }) => ((await (await get("/api/dashboards", session.cookie)).json()) as { dashboards: { slug: string }[] }).dashboards.map((d) => d.slug);
  // Os cartões saem na ordem das categorias que a administração definiu, e não na do registro: aqui só conta quais saem.
  const sameSlugs = (a: string[], b: string[]) => assert.deepEqual([...a].sort(), [...b].sort());
  assert.deepEqual(await cards(one), [target.slug]);
  sameSlugs(await cards(total), DASHBOARDS.map((d) => d.slug));
  sameSlugs(await cards(boss), DASHBOARDS.map((d) => d.slug));
  assert.deepEqual(await cards(none), []);
  console.log("OK, o painel só mostra os cartões permitidos, e o administrador vê todos.");

  // Quem não tem o dashboard recebe a mesma resposta de um dashboard que não existe, nas rotas, na miniatura e no agente.
  const same = async (slug: string, route: string, session: { cookie: string }, method = "GET") => {
    const real = await fetch(`${base}/api/d/${slug}/${route}`, { method, headers: { cookie: session.cookie, "Content-Type": "application/json", "X-CSRF-Token": "x" }, body: method === "POST" ? "{}" : undefined });
    const missing = await fetch(`${base}${MISSING}/${route}`, { method, headers: { cookie: session.cookie, "Content-Type": "application/json", "X-CSRF-Token": "x" }, body: method === "POST" ? "{}" : undefined });
    return [{ status: real.status, type: real.headers.get("content-type"), body: await real.text() }, { status: missing.status, type: missing.headers.get("content-type"), body: await missing.text() }] as const;
  };
  const other = DASHBOARDS.find((d) => d.slug !== target.slug);
  const denied = other ? { session: one, slug: other.slug } : { session: none, slug: first.slug };
  for (const [route, method] of [["info", "GET"], ["thumbnail", "GET"], ["agent", "GET"], ["agent", "POST"], ["summary", "GET"], ["check", "GET"]] as const) {
    const [real, missing] = await same(denied.slug, route, denied.session, method);
    assert.equal(real.status, 404, `${route} ${method}`);
    assert.deepEqual(real, missing, `${route} ${method}`);
  }
  console.log("OK, dashboard sem acesso responde 404 igual ao que não existe (rotas, miniatura e agente).");
  // A recusa de CSRF não vem antes da de acesso: sem token certo, quem não tem o dashboard ainda recebe 404.
  assert.equal((await postAs(denied.session, `/api/d/${denied.slug}/agent`, { question: "Quanto?" })).status, 404);

  // Administração: só o administrador.
  for (const [name, session] of [["limitado", one], ["total", total], ["sem acesso", none]] as const) {
    assert.equal((await get("/api/admin/overview", session.cookie)).status, 403, name);
    assert.equal((await postAs(session, "/api/admin/create-user", { login: "teste_x" })).status, 403, name);
    assert.equal((await postAs(session, "/api/admin/set-access", { userId: fx.ids.teste_nenhum, dashboard: first.slug, mode: "all" })).status, 403, name);
  }
  assert.equal((await get("/api/admin/overview", boss.cookie)).status, 200);
  assert.equal((await post("/api/admin/create-user", { login: "teste_semcsrf" }, { cookie: boss.cookie })).status, 403, "administrador sem CSRF");
  assert.equal((await post("/api/admin/create-user", { login: "teste_semcsrf" }, { cookie: boss.cookie, "X-CSRF-Token": "errado" })).status, 403);
  assert.equal((await fx.portal.query("SELECT 1 FROM app_user WHERE login = 'teste_semcsrf'")).rows.length, 0);
  console.log("OK, só o administrador abre a administração, e escrever pede o token CSRF.");

  // Criar pessoa, dar acesso, senha provisória, troca obrigatória.
  const created = await json(await postAs(boss, "/api/admin/create-user", { login: "teste_nova", name: "Pessoa de teste" }));
  assert.equal(created.status, 200);
  const provisional = created.body.password as string;
  assert.match(provisional, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  const row = (await fx.portal.query("SELECT pass_hash, pass_salt, must_change_password FROM app_user WHERE login = 'teste_nova'")).rows[0];
  assert.ok(!JSON.stringify(row).includes(provisional), "a senha provisória não fica guardada em texto");
  assert.equal(Boolean(row.must_change_password), true);
  assert.equal((await json(await postAs(boss, "/api/admin/create-user", { login: "teste_nova" }))).status, 400, "usuário repetido");
  const fresh = await login("teste_nova", provisional);
  assert.deepEqual(await cards(fresh).catch(() => "bloqueado"), "bloqueado", "senha provisória: nenhum dashboard antes da troca");
  assert.equal((await get(`/api/d/${first.slug}/info`, fresh.cookie)).status, 403);
  assert.equal((await get("/api/dashboards", fresh.cookie)).status, 403);
  const me = await (await get("/api/me", fresh.cookie)).json() as { mustChangePassword: boolean };
  assert.equal(me.mustChangePassword, true);
  assert.equal((await postAs(fresh, "/api/password", { current: provisional, next: "curta" })).status, 400);
  assert.equal((await postAs(fresh, "/api/password", { current: provisional, next: provisional })).status, 400);
  assert.equal((await postAs(fresh, "/api/password", { current: "errada", next: "uma-senha-nova-1" })).status, 400);
  assert.equal((await postAs(fresh, "/api/password", { current: provisional, next: "uma-senha-nova-1" })).status, 200);
  assert.deepEqual(await cards(fresh), [], "depois da troca, a pessoa não tem nenhum dashboard até o administrador marcar");
  assert.equal((await post("/api/login", { login: "teste_nova", password: provisional })).status, 401, "a provisória deixou de valer");
  assert.equal((await post("/api/login", { login: "teste_nova", password: "uma-senha-nova-1" })).status, 200);
  console.log("OK, senha provisória: guardada só em hash, obriga a troca, e a antiga deixa de valer.");

  const setAccess = (userId: string, slug: string, mode: string, codes?: string[]) => postAs(boss, "/api/admin/set-access", { userId, dashboard: slug, mode, codes });
  const newId = fx.ids.teste_nova ?? String((await fx.portal.query("SELECT id FROM app_user WHERE login = 'teste_nova'")).rows[0].id);
  if (scoped?.scope) {
    const { label } = scoped.scope;
    assert.equal((await setAccess(newId, scoped.slug, "some", [firstCode!])).status, 200);
    assert.deepEqual(await cards(fresh), [scoped.slug]);
    const empty = await json(await setAccess(newId, scoped.slug, "some", []));
    assert.deepEqual([empty.status, empty.body.error], [400, atLeastOne(label)]);
    const unknown = await json(await setAccess(newId, scoped.slug, "some", ["codigo-que-nao-existe"]));
    assert.deepEqual([unknown.status, unknown.body.error], [400, invalidItem(label)]);
    assert.equal((await setAccess(newId, scoped.slug, "none")).status, 200);
  } else {
    console.log("AVISO, nenhum dashboard do projeto tem recorte: o acesso parcial não foi provado.");
  }
  // Dashboard sem recorte: o acesso é com ou sem, e escolher itens é recusado sem gravar nada.
  for (const plain of DASHBOARDS.filter((d) => !d.scope)) {
    assert.equal((await setAccess(newId, plain.slug, "some", ["qualquer"])).status, 400, plain.slug);
    assert.equal((await fx.portal.query("SELECT 1 FROM dashboard_access WHERE user_id = $1 AND dashboard = $2", [newId, plain.slug])).rows.length, 0, plain.slug);
  }
  assert.equal((await setAccess(newId, "nao-existe", "all")).status, 400);
  assert.equal((await setAccess(newId, first.slug, "qualquer")).status, 400);
  assert.equal((await setAccess(fx.ids.teste_admin, first.slug, "none")).status, 400, "o administrador não é alterado");
  assert.equal((await setAccess(newId, first.slug, "all")).status, 200);
  assert.equal((await setAccess(newId, first.slug, "none")).status, 200);
  assert.deepEqual(await cards(fresh), [], "tirar o acesso vale na hora");
  assert.equal((await get(`/api/d/${first.slug}/info`, fresh.cookie)).status, 404);
  console.log("OK, marcar dashboards e o recorte vale na hora, e valor inválido é recusado.");

  // Desativar derruba a sessão; reativar devolve a entrada; redefinir exige nova troca.
  assert.equal((await postAs(boss, "/api/admin/set-active", { userId: newId, active: false })).status, 200);
  assert.equal((await get("/api/dashboards", fresh.cookie)).status, 401);
  assert.equal((await post("/api/login", { login: "teste_nova", password: "uma-senha-nova-1" })).status, 401);
  assert.equal((await postAs(boss, "/api/admin/set-active", { userId: newId, active: true })).status, 200);
  const back = await login("teste_nova", "uma-senha-nova-1");
  const reset = await json(await postAs(boss, "/api/admin/reset-password", { userId: newId }));
  assert.equal(reset.status, 200);
  assert.equal((await get("/api/dashboards", back.cookie)).status, 401, "redefinir derruba as sessões");
  const again = await login("teste_nova", reset.body.password);
  assert.equal((await get("/api/dashboards", again.cookie)).status, 403, "a nova provisória obriga a troca");
  console.log("OK, desativar, reativar e redefinir senha.");

  // Escopo da sessão e CSRF.
  const agentNoToken = await fetch(`${base}/api/d/${first.slug}/agent`, { method: "POST", headers: { "Content-Type": "application/json", cookie: one.cookie }, body: JSON.stringify({ question: "Quanto?" }) });
  assert.equal(agentNoToken.status, 403);
  console.log("OK, escrita sem token CSRF é recusada.");

  const stored = await fx.portal.query("SELECT token FROM app_session WHERE token = $1", [total.cookie.split("=")[1]]);
  assert.equal(stored.rows.length, 1);
  const expired = await login("teste_total");
  assert.equal((await get("/api/dashboards", expired.cookie)).status, 200);
  await fx.portal.query(`UPDATE app_session SET expires_at = ${sqlite() ? "'2000-01-01T00:00:00.000Z'" : "now() - interval '1 day'"} WHERE token = $1`, [expired.cookie.split("=")[1]]);
  assert.equal((await get("/api/dashboards", expired.cookie)).status, 401);
  console.log("OK, a sessão fica no banco, e vencida não vale mais.");

  const logoutNoToken = await fetch(`${base}/api/logout`, { method: "POST", headers: { "Content-Type": "application/json", cookie: total.cookie }, body: "{}" });
  assert.equal(logoutNoToken.status, 403);
  assert.equal((await get("/api/dashboards", total.cookie)).status, 200);
  assert.equal((await postAs(total, "/api/logout", {})).status, 200);
  assert.equal((await get("/api/dashboards", total.cookie)).status, 401);
  console.log("OK, sair sem token é recusado, e depois de sair a sessão não vale mais.");

  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) blocked = (await post("/api/login", { login: "teste_um", password: "errada" })).status === 429;
  assert.equal(blocked, true);
  console.log("OK, tentativas demais são bloqueadas.");

  console.log(`Portal com login conferido (${readEngine(process.env.DB_ENGINE)}).`);
} finally {
  await fx.stop();
}
