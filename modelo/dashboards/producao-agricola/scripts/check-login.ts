// Prova a permissão por UF (o recorte deste dashboard) dentro dele, com o servidor de verdade em modo com login, em outra porta, e pessoas temporárias.
// Rode com o banco de desenvolvimento no ar e os dados carregados. As provas do portal (login, administração, senha) estão em scripts/check-login.ts.
import assert from "node:assert/strict";
import { fixture } from "../../../scripts/lib/portal-fixture.ts";
import { ALL_STATES } from "../domain/filters.ts";

const PORT = "8789";
const SLUG = "producao-agricola";
const fx = await fixture([
  { login: "teste_mt", access: { [SLUG]: ["51"] } },
  { login: "teste_vazio", access: { [SLUG]: [] } },
  { login: "teste_total", access: { [SLUG]: "todas" } },
  { login: "teste_nenhum" },
], PORT);
const { get, post, login } = fx;
const api = (route: string) => `/api/d/${SLUG}/${route}`;

try {
  const full = await login("teste_total");
  const mt = await login("teste_mt");
  const states = await (await get(api("by-state"), mt.cookie)).json() as { rows: { key: string }[] };
  assert.deepEqual(states.rows.map((r) => r.key), ["51"]);
  const other = await (await get(api("by-state?uf=35"), mt.cookie)).json() as { rows: unknown[] };
  assert.equal(other.rows.length, 0);
  const options = await (await get(api("filter-options"), mt.cookie)).json() as { uf: { key: string }[]; scopeLabel: string };
  assert.deepEqual(options.uf.map((o) => o.key), ["51"]);
  assert.equal((await get(api("check"), mt.cookie)).status, 403);
  const info = await (await get(api("info"), mt.cookie)).json() as { canCheck: boolean };
  assert.equal(info.canCheck, false);
  assert.equal(options.scopeLabel, "Mato Grosso");
  console.log("OK, a pessoa limitada vê só o estado dela, nem pela URL vê outro, e não acessa a conferência.");

  const crops = await (await get(api("filter-options?ano=todos"), full.cookie)).json() as { lavoura: { key: string }[] };
  const mine = await (await get(api("filter-options?ano=todos"), mt.cookie)).json() as { lavoura: { key: string }[] };
  const outside = crops.lavoura.find((crop) => !mine.lavoura.some((own) => own.key === crop.key));
  assert.ok(outside, "o banco precisa ter uma lavoura fora de Mato Grosso");
  const refused = await get(api(`summary?lavoura=${outside.key}`), mt.cookie);
  const unknown = await get(api("summary?lavoura=999999999"), mt.cookie);
  assert.equal(refused.status, 400);
  assert.equal(unknown.status, 400);
  assert.deepEqual(await refused.json(), await unknown.json());
  console.log("OK, lavoura só de fora da permissão recebe a mesma resposta de uma que não existe.");

  const ask = (session: { cookie: string; csrf: string }, withToken: boolean, question: string) => fetch(fx.base + api("agent"), {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: session.cookie, ...(withToken ? { "X-CSRF-Token": session.csrf } : {}) },
    body: JSON.stringify({ question, query: "" }),
  });
  assert.equal((await ask(mt, false, "Quanto por estado?")).status, 403);
  const agent = await (await ask(mt, true, "Qual o valor por estado?")).json() as { status: string; text: string };
  assert.equal(agent.status, "answered");
  assert.match(agent.text, /Mato Grosso/);
  assert.doesNotMatch(agent.text, /São Paulo/);
  console.log("OK, o agente respeita a permissão da sessão, e escrever pede o token CSRF.");

  const empty = await login("teste_vazio");
  assert.equal(((await (await get(api("by-state"), empty.cookie)).json()) as { rows: unknown[] }).rows.length, 0);
  assert.equal(((await (await get(api("detail"), empty.cookie)).json()) as { rows: unknown[] }).rows.length, 0);
  assert.equal(((await (await get(api("filter-options"), empty.cookie)).json()) as { hasAccess: boolean }).hasAccess, false);
  console.log("OK, acesso com a lista de UFs vazia não traz linhas.");

  const all = await (await get(api("by-state"), full.cookie)).json() as { rows: unknown[] };
  // Todas as UFs que têm dado: tantas quantas o seletor de quem tem acesso total mostra, e mais de uma.
  const everything = await (await get(api("filter-options"), full.cookie)).json() as { uf: unknown[] };
  assert.equal(all.rows.length, everything.uf.length);
  assert.ok(all.rows.length > 1 && all.rows.length <= ALL_STATES.length);
  assert.equal((await get(api("check"), full.cookie)).status, 200);
  console.log("OK, acesso total é um perfil explícito.");

  const none = await login("teste_nenhum");
  assert.equal((await get(api("summary"), none.cookie)).status, 404);
  assert.equal((await post("/api/login", { login: "teste_nenhum", password: "errada" })).status, 401);
  console.log("OK, quem não tem este dashboard recebe 404 em tudo.");

  console.log("Permissão por UF do dashboard conferida.");
} finally {
  await fx.stop();
}
