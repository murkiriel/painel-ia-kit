// Peças comuns das provas que sobem o servidor de verdade com login: pessoas temporárias no portal e chamadas HTTP.
// As pessoas se chamam teste_*, e todas saem do banco ao final. Nada aqui toca em dado de dashboard.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../../server/auth.ts";
import { DASHBOARDS } from "../../server/dashboards.ts";
import { openAdmin, readEngine } from "../../server/db/open.ts";
import type { Db } from "../../server/db/types.ts";

export type TestUser = {
  login: string;
  admin?: boolean;
  active?: boolean;
  provisional?: boolean;
  /** Por dashboard: "todas" (acesso total, ou o único acesso de um dashboard sem recorte) ou a lista de códigos do recorte. */
  access?: Record<string, "todas" | string[]>;
};

export type Session = { csrf: string; cookie: string };

export const sqlite = () => readEngine(process.env.DB_ENGINE) === "sqlite";

export async function addUsers(portal: Db, users: TestUser[], password: string): Promise<Record<string, string>> {
  const { hash, salt } = hashPassword(password);
  const ids: Record<string, string> = {};
  for (const user of users) {
    const { rows } = await portal.query(
      "INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin, active, must_change_password) VALUES ($1, $1, $2, $3, $4, $5, $6) RETURNING id",
      [user.login, hash, salt, user.admin === true, user.active !== false, user.provisional === true],
    );
    ids[user.login] = String(rows[0].id);
    for (const [slug, access] of Object.entries(user.access ?? {})) {
      await portal.query(
        "INSERT INTO dashboard_access (user_id, dashboard, full_access, state_codes) VALUES ($1, $2, $3, $4)",
        [rows[0].id, slug, access === "todas", access === "todas" ? [] : access],
      );
    }
  }
  return ids;
}

export async function removeTestUsers(portal: Db) {
  // Sessões e acessos saem junto, pela chave estrangeira.
  await portal.query("DELETE FROM app_user WHERE login LIKE 'teste_%'");
}

export async function startServer(port: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  const server = spawn(process.execPath, ["--env-file-if-exists=.env", "server/main.ts"], { windowsHide: true,
    env: { ...process.env, AUTH_MODE: "login", PORT: port, HOST: "127.0.0.1", AGENT_PROVIDER: "simulado", AGENT_LIMIT_PER_HOUR: "1000000", ...env },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/me`);
      return server;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  server.kill();
  throw new Error(`O servidor na porta ${port} não subiu.`);
}

export async function fixture(users: TestUser[], port: string) {
  const password = randomBytes(12).toString("hex");
  const portal = await openAdmin("portal");
  await removeTestUsers(portal);
  const ids = await addUsers(portal, users, password);
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer(port);

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const get = (path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { cookie } : {} });

  async function login(user: string, pass = password): Promise<Session> {
    const response = await post("/api/login", { login: user, password: pass });
    if (response.status !== 200) throw new Error(`login de ${user}: ${response.status}`);
    const { csrf } = await response.json() as { csrf: string };
    return { csrf, cookie: response.headers.get("set-cookie")!.split(";")[0] };
  }
  const postAs = (session: Session, path: string, body: unknown) => post(path, body, { cookie: session.cookie, "X-CSRF-Token": session.csrf });

  return {
    base, password, portal, ids, server, post, get, login, postAs,
    async stop() {
      server.kill();
      await removeTestUsers(portal);
      await portal.end();
    },
  };
}

export const slugs = DASHBOARDS.map((d) => d.slug);
