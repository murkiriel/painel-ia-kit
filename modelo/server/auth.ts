// Login por sessão: hash scrypt, token em cookie httpOnly e CSRF por sessão.
// Com AUTH_MODE=local não há login, e o servidor escuta só na própria máquina.
// O que cada pessoa vê de cada dashboard fica em dashboard_access; o administrador vê tudo.
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardScope } from "../shared/scope.ts";
import { openFirstUser } from "./db/open.ts";
import type { Db } from "./db/types.ts";

const SESSION_DAYS = 7;
const COOKIE = "dash_session";
const MAX_ATTEMPTS = 10;
const MAX_ATTEMPTS_BY_ADDRESS = 100;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_TRACKED = 10_000;
const MIN_FIRST_PASSWORD = 8;
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
// Quem repassa pedidos costuma deixar um destes. Um proxy que não deixe nenhum não dá para detectar: o README avisa.
const PROXY_HEADER = /^(?:forwarded|via|client-ip|true-client-ip|x-real-ip|x-client-ip|x-cluster-client-ip|fastly-client-ip|x-forwarded(?:-.*)?|x-original-.*|x-envoy-.*|x-vercel-.*|x-amz-.*|cf-.*)$/;
// Letras, números e . _ @ -, com espaços só no meio. Sem isso, um caractere invisível criaria um login que ninguém consegue digitar.
const LOGIN_FORMAT = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._@-]*[\p{L}\p{N}])?$/u;

export type User = { id: string; login: string; name: string; isAdmin: boolean; mustChangePassword: boolean };
/**
 * O que a pessoa pode ver de cada dashboard (pelo slug). Sem entrada, o dashboard não existe para ela.
 * "codes" são os códigos do recorte do dashboard (fazenda, unidade...), e só valem quando "full" é falso.
 */
export type Access = Record<string, { full: boolean; codes: string[] }>;
export type Session = { token: string; csrf: string; user: User };

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  return { hash: crypto.scryptSync(password, salt, 64).toString("hex"), salt };
}

export function passwordMatches(password: string, hash: string, salt: string): boolean {
  const computed = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === computed.length && crypto.timingSafeEqual(computed, expected);
}

/**
 * O pedido veio desta máquina? Só assim o primeiro login pode ser criado. Atrás de um proxy, todo pedido parece local:
 * cabeçalho de proxy recusa. Host e Origin barram um site aberto no navegador tentando alcançar o servidor local.
 */
export function isLocalRequest(req: Pick<IncomingMessage, "headers"> & { socket: { remoteAddress?: string } }): boolean {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? "")) return false;
  const { headers } = req;
  if (Object.keys(headers).some((name) => PROXY_HEADER.test(name.toLowerCase()))) return false;
  const host = String(headers.host ?? "");
  if (!LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ""))) return false;
  const origin = headers.origin;
  return origin === undefined || origin === `http://${host}` || origin === `https://${host}`;
}

/** O mesmo texto ao criar e ao entrar: sem espaços em volta, e com o acento em uma forma só. */
export const cleanedLogin = (login: string) => login.trim().normalize("NFC");
const cleanLogin = cleanedLogin;

/** Sem login é uma escolha explícita. Valor desconhecido nunca abre o acesso: o servidor não sobe. */
export function readAuthMode(value: string | undefined): "local" | "login" {
  if (value === "local" || value === "login") return value;
  throw new Error('AUTH_MODE precisa ser "local" ou "login".');
}

/**
 * A única regra de permissão por dashboard. Devolve nulo se o dashboard não existe para a pessoa, ou a lista de códigos que as consultas recebem.
 * - Sem linha de acesso: nulo.
 * - Dashboard sem recorte: só o acesso total vale (nulo para uma linha parcial antiga), e a lista é sempre vazia.
 * - Dashboard com recorte: acesso total dá todos os códigos; a lista parcial sai sem repetidos e só com códigos conhecidos.
 *   Sem perfil nem lista, a permissão é vazia, nunca "tudo".
 */
export function grantedScope(d: { scope?: DashboardScope }, granted: { full: boolean; codes: string[] } | undefined): string[] | null {
  if (!granted) return null;
  if (!d.scope) return granted.full ? [] : null;
  const all = d.scope.items.map((item) => item.code);
  return granted.full ? all : [...new Set(granted.codes)].filter((code) => all.includes(code));
}

/** A regra de senha é uma só: no primeiro login, na troca e na redefinição. */
export function passwordIsInvalid(password: unknown, login: string): boolean {
  if (typeof password !== "string") return true;
  if (password.length < MIN_FIRST_PASSWORD || password.length > MAX_PASSWORD_LENGTH || password === login) return true;
  // Precisa de algo visível, e nada de caractere de controle.
  return /\p{Cc}/u.test(password) || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(password);
}

// Sem 0, O, 1, l e I: a senha provisória é lida de uma tela e digitada à mão.
const PROVISIONAL_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Senha provisória sorteada, em 3 grupos de 4: o administrador a vê uma vez e a repassa. */
export function provisionalPassword(): string {
  const pick = () => PROVISIONAL_ALPHABET[crypto.randomInt(PROVISIONAL_ALPHABET.length)];
  return [0, 1, 2].map(() => Array.from({ length: 4 }, pick).join("")).join("-");
}

export const loginIsValid = (login: string) => login.length <= MAX_LOGIN_LENGTH && LOGIN_FORMAT.test(login);

// Usuário inexistente gasta o mesmo tempo de hash, para não revelar quem existe.
const decoy = hashPassword("usuario-inexistente");

const attempts = new Map<string, { count: number; since: number }>();

// Conta por usuário e endereço: atrás de um proxy, todos dividem o mesmo endereço.
function allowAttempt(key: string, limit: number): boolean {
  const now = Date.now();
  // O mapa nunca cresce sem limite: entradas vencidas saem antes de ele encher.
  if (attempts.size >= MAX_TRACKED) {
    for (const [tracked, entry] of attempts) {
      if (now - entry.since > ATTEMPT_WINDOW_MS) attempts.delete(tracked);
    }
    if (attempts.size >= MAX_TRACKED) return false;
  }
  const entry = attempts.get(key);
  if (!entry || now - entry.since > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { count: 1, since: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const split = part.indexOf("=");
    if (split > 0 && part.slice(0, split).trim() === name) return part.slice(split + 1).trim();
  }
  return null;
}

// No SQLite, a lista de códigos do recorte fica em JSON, e a data, em texto ISO.
export const codesOf = (codes: string[] | string) => (typeof codes === "string" ? (JSON.parse(codes) as string[]) : codes);

const userOf = (r: Record<string, any>): User => ({
  id: String(r.id), login: r.login, name: r.name, isAdmin: Boolean(r.is_admin), mustChangePassword: Boolean(r.must_change_password),
});

/**
 * @param pool login: usuários, acessos e sessões (só leitura de pessoas)
 * @param portal administração: cria e altera pessoas e acessos. Só é usado depois de o servidor conferir quem pede.
 */
export function createAuth(pool: Db | null, portal: Db | null, secureCookie: boolean) {
  const sqlite = pool?.engine === "sqlite";
  const NOW = sqlite ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : "now()";
  const EXPIRES = sqlite ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || $4 || ' days')" : "now() + make_interval(days => $4)";
  const cookie = (value: string, maxAge: number) =>
    `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;

  return {
    async hasUsers(): Promise<boolean> {
      if (!pool) return true;
      return (await pool.query("SELECT 1 AS found FROM app_user LIMIT 1")).rows.length > 0;
    },

    /** Grava só com a tabela vazia, e o banco é quem garante. Devolve o erro para a tela, ou null se criou. */
    async createFirstUser(login: unknown, password: unknown): Promise<"invalid" | "exists" | null> {
      if (!pool) return "exists";
      if (typeof login !== "string" || typeof password !== "string") return "invalid";
      const name = cleanLogin(login);
      if (!loginIsValid(name) || passwordIsInvalid(password, name)) return "invalid";
      const { hash, salt } = hashPassword(password);
      if (!sqlite) {
        const { rows } = await pool.query("SELECT create_first_user($1, $2, $3, $4) AS created", [name, name, hash, salt]);
        return rows[0].created ? null : "exists";
      }
      const writer = await openFirstUser();
      try {
        const { rows } = await writer.query(
          "INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin) SELECT $1, $2, $3, $4, 1 WHERE NOT EXISTS (SELECT 1 FROM app_user) RETURNING id",
          [name, name, hash, salt],
        );
        return rows.length > 0 ? null : "exists";
      } finally {
        await writer.end();
      }
    },

    async login(login: string, password: string, ip: string, res: ServerResponse): Promise<Session | null | "blocked"> {
      if (!pool) return null;
      login = cleanLogin(login); // o mesmo tratamento de quando o primeiro login foi criado
      if (/\p{Cc}/u.test(login)) return null; // o banco recusaria com erro: é só um login que não existe
      // Antes de tudo: login gigante não entra no banco nem na memória, e scrypt não roda à toa.
      if (login.length > MAX_LOGIN_LENGTH || password.length > MAX_PASSWORD_LENGTH) return null;
      const attemptKey = `${login}|${ip}`;
      // O limite por endereço pega quem testa uma senha contra muitos usuários.
      if (!allowAttempt(`endereco|${ip}`, MAX_ATTEMPTS_BY_ADDRESS)) return "blocked";
      if (!allowAttempt(attemptKey, MAX_ATTEMPTS)) return "blocked";
      const { rows } = await pool.query("SELECT * FROM app_user WHERE login = $1", [login]);
      const user = rows[0];
      if (!user) {
        passwordMatches(password, decoy.hash, decoy.salt);
        return null;
      }
      // Pessoa desativada recebe a mesma resposta de senha errada.
      if (!passwordMatches(password, user.pass_hash, user.pass_salt) || !user.active) return null;

      attempts.delete(attemptKey);
      await pool.query(`DELETE FROM app_session WHERE expires_at < ${NOW}`);
      const token = crypto.randomBytes(32).toString("hex");
      const csrf = crypto.randomBytes(32).toString("hex");
      await pool.query(
        `INSERT INTO app_session (token, csrf, user_id, expires_at) VALUES ($1, $2, $3, ${EXPIRES})`,
        [token, csrf, user.id, SESSION_DAYS],
      );
      res.setHeader("Set-Cookie", cookie(token, SESSION_DAYS * 86_400));
      return { token, csrf, user: userOf(user) };
    },

    async logout(session: Session, res: ServerResponse) {
      await pool?.query("DELETE FROM app_session WHERE token = $1", [session.token]);
      res.setHeader("Set-Cookie", cookie("", 0));
    },

    async session(req: IncomingMessage): Promise<Session | null> {
      const token = readCookie(req, COOKIE);
      if (!token || !pool) return null;
      const { rows } = await pool.query(`
        SELECT s.token, s.csrf, u.id, u.login, u.name, u.is_admin, u.must_change_password
        FROM app_session s JOIN app_user u ON u.id = s.user_id
        WHERE s.token = $1 AND s.expires_at > ${NOW} AND u.active`, [token]);
      const r = rows[0];
      return r ? { token: r.token, csrf: r.csrf, user: userOf(r) } : null;
    },

    /** O que a pessoa vê de cada dashboard. O administrador não depende desta lista: o servidor dá a ele tudo. */
    async access(userId: string): Promise<Access> {
      if (!pool) return {};
      const { rows } = await pool.query("SELECT dashboard, full_access, state_codes FROM dashboard_access WHERE user_id = $1", [userId]);
      return Object.fromEntries(rows.map((r) => [r.dashboard as string, { full: Boolean(r.full_access), codes: codesOf(r.state_codes) }]));
    },

    csrfMatches(req: IncomingMessage, session: Session): boolean {
      const sent = Buffer.from(String(req.headers["x-csrf-token"] ?? ""));
      const expected = Buffer.from(session.csrf);
      return sent.length === expected.length && crypto.timingSafeEqual(sent, expected);
    },

    /**
     * A própria pessoa troca a senha: precisa da atual. As outras sessões dela caem, e a provisória deixa de valer.
     * Devolve o motivo da recusa, ou null se trocou.
     */
    async changePassword(session: Session, current: unknown, next: unknown): Promise<"wrong" | "invalid" | "same" | null> {
      if (!pool || !portal || typeof current !== "string" || typeof next !== "string" || current.length > MAX_PASSWORD_LENGTH) return "invalid";
      const { rows } = await pool.query("SELECT pass_hash, pass_salt FROM app_user WHERE id = $1", [session.user.id]);
      if (!rows[0] || !passwordMatches(current, rows[0].pass_hash, rows[0].pass_salt)) return "wrong";
      if (passwordIsInvalid(next, session.user.login)) return "invalid";
      if (next === current) return "same";
      const { hash, salt } = hashPassword(next);
      await portal.query("UPDATE app_user SET pass_hash = $2, pass_salt = $3, must_change_password = $4 WHERE id = $1", [session.user.id, hash, salt, false]);
      await portal.query("DELETE FROM app_session WHERE user_id = $1 AND token <> $2", [session.user.id, session.token]);
      return null;
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
