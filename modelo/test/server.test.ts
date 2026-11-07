// O servidor de verdade, com login, em um SQLite temporário e uma porta livre desta máquina. Sem rede, dado real ou credencial real.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { hashPassword } from "../server/auth.ts";
import { producaoAgricola } from "../dashboards/producao-agricola/dashboard.ts";
import { createSqliteFile, openSqlite, writeRows } from "../server/db/sqlite.ts";

const dir = mkdtempSync(path.join(tmpdir(), "dash-server-test-"));
const password = randomBytes(12).toString("hex");
let server: ChildProcess;
let base = "";

const line = (year: number, state: string, stateName: string, region: string, crop: string, cropName: string) => ({
  year, state_code: state, state_name: stateName, region, crop_code: crop, crop_name: cropName, value_brl: "10.00", quantity_t: "1.000", quantity_unit: "t", area_ha: "1.000",
});

before(async () => {
  const file = path.join(dir, "producao-agricola.sqlite");
  createSqliteFile(file, producaoAgricola.sqlite({}));
  createSqliteFile(path.join(dir, "portal.sqlite"), { sql: ["server/sql/sqlite_portal_schema.sql"] });
  const data = openSqlite(file, null);
  const db = data.handle();
  db.exec("BEGIN");
  writeRows(db, "production", [
    line(2024, "53", "Distrito Federal", "Centro-Oeste", "1", "Soja"),
    line(2024, "41", "Paraná", "Sul", "1", "Soja"),
    // Só fora da permissão do usuário do DF.
    line(2024, "41", "Paraná", "Sul", "2", "Erva-mate"),
    line(2020, "41", "Paraná", "Sul", "1", "Soja"),
  ]);
  writeRows(db, "load_log", [{ entity: "teste", started_at: "2026-10-30T10:00:00.000Z", finished_at: "2026-10-30T10:01:00.000Z", status: "ok" }]);
  db.exec("COMMIT");
  await data.end();
  const { hash, salt } = hashPassword(password);
  const admin = openSqlite(path.join(dir, "portal.sqlite"), null);
  // "vazio" tem o dashboard, mas com a lista de UFs vazia; "semdado" tem uma UF que não existe nos dados; "nenhum" nem tem o dashboard.
  for (const [login, full, states] of [["df", false, ["53"]], ["total", true, []], ["vazio", false, []], ["semdado", false, ["99"]]] as const) {
    const { rows } = await admin.query("INSERT INTO app_user (login, name, pass_hash, pass_salt) VALUES ($1, $1, $2, $3) RETURNING id", [login, hash, salt]);
    await admin.query("INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, 'producao-agricola', $2, $3)", [rows[0].id, full, states]);
  }
  await admin.query("INSERT INTO app_user (login, name, pass_hash, pass_salt) VALUES ('nenhum', 'nenhum', $1, $2)", [hash, salt]);
  await admin.end();
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

after(async () => {
  server?.removeAllListeners("exit");
  server?.kill();
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

async function login(user: string) {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: user, password }) });
  assert.equal(response.status, 200);
  return { csrf: ((await response.json()) as { csrf: string }).csrf, cookie: response.headers.get("set-cookie")!.split(";")[0] };
}
// Os caminhos dos testes são os do dashboard: /api/<rota> vira /api/d/producao-agricola/<rota>.
const get = async (address: string, cookie: string) => {
  const response = await fetch(base + address.replace("/api/", "/api/d/producao-agricola/"), { headers: { cookie } });
  return { status: response.status, body: await response.json() as Record<string, any> };
};

test("sair sem o token CSRF é recusado, e a sessão continua. Com ele, a sessão acaba", async () => {
  const { cookie, csrf } = await login("total");
  const post = (headers: Record<string, string>) => fetch(`${base}/api/logout`, { method: "POST", headers: { "Content-Type": "application/json", cookie, ...headers }, body: "{}" });
  assert.equal((await post({})).status, 403);
  assert.equal((await get("/api/summary", cookie)).status, 200);
  assert.equal((await post({ "X-CSRF-Token": "errado" })).status, 403);
  assert.equal((await post({ "X-CSRF-Token": csrf })).status, 200);
  assert.equal((await get("/api/summary", cookie)).status, 401);
});

test("conferência: só com acesso total", async () => {
  assert.equal((await get("/api/check", (await login("df")).cookie)).status, 403);
  assert.equal((await get("/api/check", (await login("vazio")).cookie)).status, 403);
  assert.equal((await get("/api/check", (await login("total")).cookie)).status, 200);
});

test("permissão: lavoura ou ano só de fora recebem a mesma resposta do que não existe", async () => {
  const { cookie } = await login("df");
  for (const route of ["summary", "by-state", "by-crop", "by-region", "by-year", "detail", "filter-options"]) {
    const outside = await get(`/api/${route}?lavoura=2`, cookie);
    const unknown = await get(`/api/${route}?lavoura=99999`, cookie);
    assert.equal(outside.status, 400, route);
    assert.deepEqual(outside, unknown, route);
    const pastOutside = await get(`/api/${route}?ano=2020`, cookie);
    const pastUnknown = await get(`/api/${route}?ano=1999`, cookie);
    assert.equal(pastOutside.status, 400, route);
    assert.deepEqual(pastOutside, pastUnknown, route);
  }
  const { cookie: full } = await login("total");
  assert.equal((await get("/api/summary?lavoura=2", full)).status, 200);
  assert.equal((await get("/api/summary?ano=2020", full)).status, 200);
});

test("permissão: quem não tem acesso nenhum recebe vazio, sem recusa, para a tela explicar", async () => {
  for (const user of ["vazio", "semdado"]) {
    const { cookie } = await login(user);
    for (const address of ["/api/filter-options?lavoura=2", "/api/filter-options?ano=2020", "/api/summary?lavoura=99999", "/api/summary?ano=1999"]) {
      assert.equal((await get(address, cookie)).status, 200, `${user} ${address}`);
    }
    assert.equal((await get("/api/filter-options?ano=2020", cookie)).body.hasAccess, false, user);
  }
});

test("permissão: a UF de fora não traz nada, e a lista de nomes não a cita", async () => {
  const { cookie } = await login("df");
  assert.deepEqual((await get("/api/by-state?uf=41", cookie)).body.rows, []);
  const options = (await get("/api/filter-options?uf=41", cookie)).body;
  assert.deepEqual(options.labels.uf, { 53: "Distrito Federal" });
  assert.deepEqual(options.labels.regiao, { "Centro-Oeste": "Centro-Oeste" });
  assert.deepEqual(options.labels.lavoura, { 1: "Soja" });
});
