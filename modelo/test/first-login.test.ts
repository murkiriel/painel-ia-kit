// Primeiro login, com o servidor de verdade, em um SQLite temporário. Sem rede, dado real ou credencial real.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { isLocalRequest } from "../server/auth.ts";
import { openFirstUser } from "../server/db/open.ts";
import { createSqliteFile, openSqlite } from "../server/db/sqlite.ts";

const dir = mkdtempSync(path.join(tmpdir(), "dash-first-login-"));
// Um projeto de teste: só o arquivo do portal. Os dos dashboards nem existem, e o servidor sobe mesmo assim.
const portalSql = ["server/sql/sqlite_portal_schema.sql"];
const file = path.join(dir, "portal.sqlite");
const password = "senha-de-teste-1";
let server: ChildProcess;
let base = "";

before(async () => {
  createSqliteFile(file, { sql: portalSql });
  server = spawn(process.execPath, ["server/main.ts"], { windowsHide: true,
    env: { ...process.env, DB_ENGINE: "sqlite", SQLITE_DIR: dir, AUTH_MODE: "login", HOST: "127.0.0.1", PORT: "0", AGENT_PROVIDER: "", MONTH_FILTER: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  base = await new Promise<string>((resolve, reject) => {
    let text = "";
    server.stdout!.on("data", (chunk) => {
      text += chunk;
      const found = /http:\/\/127\.0\.0\.1:\d+/.exec(text);
      if (found) resolve(found[0]);
    });
    server.once("exit", (code) => reject(new Error(`O servidor parou: ${code}`)));
  });
}, { timeout: 60_000 });

after(() => {
  server?.removeAllListeners("exit");
  server?.kill();
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** node:http, porque o fetch não deixa escolher o cabeçalho Host. */
const send = (headers: Record<string, string>, body: object) =>
  new Promise<{ status: number; body: Record<string, any>; cookie: string | undefined }>((resolve, reject) => {
    const text = JSON.stringify(body);
    const call = request(`${base}/api/first-login`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers } }, (res) => {
      let answer = "";
      res.on("data", (part) => { answer += part; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(answer), cookie: res.headers["set-cookie"]?.[0] }));
    });
    call.on("error", reject);
    call.end(text);
  });

const me = async (cookie?: string) => (await fetch(`${base}/api/me`, { headers: cookie ? { cookie } : {} })).json() as Promise<Record<string, any>>;
const users = async () => {
  const admin = openSqlite(file, null);
  try {
    return (await admin.query("SELECT login, is_admin FROM app_user")).rows;
  } finally {
    await admin.end();
  }
};

/** Sobe um servidor próprio e devolve em que endereço ele disse que ficou. */
const listenAddress = (folder: string) => new Promise<string>((resolve, reject) => {
  const child = spawn(process.execPath, ["server/main.ts"], { windowsHide: true,
    env: { ...process.env, DB_ENGINE: "sqlite", SQLITE_DIR: folder, AUTH_MODE: "login", HOST: "0.0.0.0", PORT: "0", AGENT_PROVIDER: "", MONTH_FILTER: "" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  let text = "";
  child.stdout!.on("data", (chunk) => {
    text += chunk;
    const found = /Portal em http:\/\/([\d.]+):/.exec(text);
    if (found) { child.kill(); resolve(found[1]); }
  });
  child.once("exit", (code) => reject(new Error(`O servidor parou: ${code}`)));
});

test("sem nenhum usuário, o servidor não escuta na rede, mesmo com HOST=0.0.0.0. Com usuário, escuta", async () => {
  const other = path.join(dir, "rede");
  createSqliteFile(path.join(other, "portal.sqlite"), { sql: portalSql });
  assert.equal(await listenAddress(other), "127.0.0.1");
  const admin = openSqlite(path.join(other, "portal.sqlite"), null);
  await admin.query("INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin) VALUES ('a', 'a', 'h', 's', 1)");
  await admin.end();
  assert.equal(await listenAddress(other), "0.0.0.0");
});

test("só é local o pedido desta máquina, sem proxy, com o Host e a Origin dela", () => {
  const local = (remoteAddress: string, headers: Record<string, string>) => isLocalRequest({ socket: { remoteAddress }, headers });
  assert.equal(local("127.0.0.1", { host: "127.0.0.1:8787" }), true);
  assert.equal(local("::1", { host: "localhost:8787" }), true);
  assert.equal(local("::ffff:127.0.0.1", { host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787" }), true);
  assert.equal(local("192.168.0.20", { host: "192.168.0.179:8787" }), false, "pela rede");
  assert.equal(local("127.0.0.1", { host: "127.0.0.1:8787", "x-forwarded-for": "8.8.8.8" }), false, "atrás de proxy");
  assert.equal(local("127.0.0.1", { host: "127.0.0.1:8787", forwarded: "for=8.8.8.8" }), false, "atrás de proxy");
  assert.equal(local("127.0.0.1", { host: "127.0.0.1:8787", "x-real-ip": "8.8.8.8" }), false, "atrás de proxy");
  for (const header of ["x-forwarded", "x-forwarded-host", "x-forwarded-proto", "via", "cf-connecting-ip", "cf-ray", "true-client-ip", "x-client-ip", "client-ip", "x-original-forwarded-for", "x-envoy-external-address", "x-vercel-id"]) {
    assert.equal(local("127.0.0.1", { host: "127.0.0.1:8787", [header]: "x" }), false, header);
  }
  assert.equal(local("127.0.0.1", { host: "site-externo.exemplo" }), false, "nome que aponta para esta máquina");
  assert.equal(local("127.0.0.1", { host: "127.0.0.1:8787", origin: "https://site-externo.exemplo" }), false, "outro site no navegador");
  assert.equal(local("127.0.0.1", {}), false, "sem Host");
});

test("a conexão do primeiro login só cria usuário: não muda, não apaga e não mexe nas sessões", async () => {
  const other = path.join(dir, "permissoes");
  createSqliteFile(path.join(other, "portal.sqlite"), { sql: portalSql });
  process.env.DB_ENGINE = "sqlite";
  process.env.SQLITE_DIR = other;
  const writer = await openFirstUser();
  try {
    for (const sql of ["UPDATE app_user SET name = 'x'", "DELETE FROM app_user", "DELETE FROM app_session", "INSERT INTO dashboard_access (user_id, dashboard) VALUES (1, 'x')", "UPDATE dashboard_access SET full_access = 1", "DROP TABLE app_user"]) {
      await assert.rejects(writer.query(sql), /prohibited|not authorized/, sql);
    }
  } finally {
    await writer.end();
  }
});

test("primeiro login: nasce uma vez, com acesso total, e só de dentro da máquina", async () => {
  assert.equal((await me()).firstLogin, "here");
  assert.equal((await fetch(`${base}/api/d/producao-agricola/summary`)).status, 401, "sem login, nenhum dado sai, mesmo sem usuário");

  const valid = { login: "  dono  ", password };
  assert.equal((await send({ "X-Forwarded-For": "8.8.8.8" }, valid)).status, 403);
  assert.equal((await send({ Origin: "https://site-externo.exemplo" }, valid)).status, 403);
  assert.equal((await send({ Host: "site-externo.exemplo" }, valid)).status, 403);
  assert.equal((await send({}, { login: "dono", password: "curta" })).status, 400);
  for (const login of ["   ", { a: 1 }, ["dono"], { toString: 1 }, "a\nb", "\u200b", "a\u0000b", "<script>", "x".repeat(129)]) {
    assert.equal((await send({}, { login, password })).status, 400, JSON.stringify(login));
  }
  assert.equal((await send({}, { login: "dono", password: 12345678 })).status, 400, "senha precisa ser texto");
  assert.equal((await send({}, { login: "dono", password: "        " })).status, 400, "senha só com espaços");
  assert.equal((await send({}, { login: "donodono", password: "donodono" })).status, 400, "senha igual ao usuário");
  assert.equal((await send({}, { login: " donodono ", password: "donodono" })).status, 400, "senha igual ao usuário, com espaços em volta");
  assert.equal((await send({}, { login: "dono", password: "\u200b\u200b\u200b\u200b\u200b\u200b\u200b\u200b" })).status, 400, "senha só com invisíveis");
  assert.equal((await send({}, { login: "dono", password: "senha\u0000de-teste" })).status, 400, "senha com caractere de controle");
  assert.deepEqual(await users(), [], "nada foi criado pelas tentativas recusadas");

  const created = await send({}, valid);
  assert.equal(created.status, 200);
  assert.equal(created.body.user.name, "dono");
  assert.equal(created.body.user.isAdmin, true, "o primeiro login é o administrador");
  assert.equal(created.body.mustChangePassword, false);
  assert.ok(created.cookie, "já entra logado");
  const cookie = created.cookie!.split(";")[0];
  assert.equal((await me(cookie)).user.name, "dono");
  assert.deepEqual((await users()).map((u) => [u.login, Number(u.is_admin)]), [["dono", 1]]);
  assert.equal((await me(cookie)).user.isAdmin, true);

  // A partir daqui, a tela de primeiro acesso não existe mais.
  assert.equal((await me()).firstLogin, undefined);
  // Quem criou com espaços em volta consegue entrar digitando igual.
  const again2 = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) });
  assert.equal(again2.status, 200);
  const loginAs = (body: object) => fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await loginAs({ login: ["dono"], password })).status, 401, "lista não vira texto");
  assert.equal((await loginAs({ login: { toString: 1 }, password })).status, 401, "objeto não derruba");
  assert.equal((await loginAs({ login: "do\u0000no", password })).status, 401, "caractere de controle é só um login que não existe");
  const again = await send({}, { login: "outro", password });
  assert.equal(again.status, 409);
  assert.equal(again.cookie, undefined);
  assert.equal((await users()).length, 1);
});
