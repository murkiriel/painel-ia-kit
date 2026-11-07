// Banco de desenvolvimento, dentro da pasta do projeto. Não vai para produção.
//
// Postgres: na primeira execução cria o servidor, o banco, os usuários, o schema do portal e o de cada dashboard, e grava o .env.
// Com o servidor já no ar, rodar de novo só acrescenta o que falta (um dashboard novo, por exemplo) e termina.
// SQLite (DB_ENGINE=sqlite no .env): cria um arquivo para o portal e um para cada dashboard, sem servidor nem porta, e termina.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { DASHBOARDS } from "../server/dashboards.ts";
import { dashboardEnv, loaderRole, PORTAL_SCHEMA, portalName, readEngine, readerRole, sqliteFile } from "../server/db/open.ts";

const DATA_DIR = ".data/postgres";
const ENV_FILE = ".env";
// Usuários do portal. Cada dashboard tem os dele, de leitura e de carga, só com permissão no schema dele.
const PORTAL_ROLES = [
  ["dash_auth", "AUTH_DATABASE_URL"],
  ["dash_portal", "PORTAL_DATABASE_URL"],
] as const;

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const sqlOf = (...parts: string[]) => readFileSync(path.join(...parts), "utf8");

if (readEngine(process.env.DB_ENGINE) === "sqlite") {
  const { createSqliteFile } = await import("../server/db/sqlite.ts");
  const portal = sqliteFile(portalName);
  const created: string[] = [];
  if (!existsSync(portal)) {
    createSqliteFile(portal, { sql: ["server/sql/sqlite_portal_schema.sql"] });
    created.push(portal);
  }
  for (const dashboard of DASHBOARDS) {
    const file = sqliteFile(dashboard.slug);
    if (existsSync(file) || dashboard.postgresOnly) continue;
    createSqliteFile(file, dashboard.sqlite(process.env));
    created.push(file);
  }
  // Portal que já existia: acrescenta as categorias, sem tocar em pessoas, sessões nem acessos.
  const { DatabaseSync } = await import("node:sqlite");
  const existing = new DatabaseSync(portal);
  if (!existing.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'category'").get()) {
    existing.exec(readFileSync("server/sql/sqlite_portal_upgrade_categories.sql", "utf8"));
    created.push("categorias do portal");
  }
  existing.close();
  console.log(created.length ? `Bancos SQLite criados: ${created.join(", ")}. Agora rode npm run load.` : "Os bancos já existem. Nada foi alterado. Para recriar um, apague o arquivo e repita.");
  process.exit(0);
}

const PORT = Number(process.env.DEV_DB_PORT || 54329);

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const entries = readFileSync(ENV_FILE, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split), line.slice(split + 1)];
  });
  return Object.fromEntries(entries);
}

const firstRun = !existsSync(`${DATA_DIR}/PG_VERSION`);
const adminPassword = firstRun ? randomBytes(18).toString("hex") : readEnv().DEV_ADMIN_PASSWORD;
const adminConfig = (password: string) => ({ host: "127.0.0.1", port: PORT, user: "dev_admin", password, database: "dashboard" });

/** O servidor já está no ar, subido por outro `npm run db`? */
async function running(): Promise<boolean> {
  if (firstRun || !adminPassword) return false;
  const probe = new pg.Client(adminConfig(adminPassword));
  try {
    await probe.connect();
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

/** Cria o que falta: usuários, o schema do portal e o de cada dashboard. O que já existe não é tocado. */
async function ensure(password: string) {
  const admin = new pg.Client(adminConfig(password));
  await admin.connect();
  const added: string[] = [];
  const newUrls: string[] = [];
  const known = readEnv();
  /** Cria o usuário se faltar e devolve se criou. A senha vai para o .env, nunca para a tela. */
  async function ensureRole(role: string, variable: string): Promise<boolean> {
    if ((await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rows.length === 0) {
      const secret = randomBytes(18).toString("hex");
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${secret}'`);
      newUrls.push(`${variable}=postgres://${role}:${secret}@127.0.0.1:${PORT}/dashboard`);
      added.push(`usuário ${role}`);
      return true;
    }
    if (!known[variable]) console.warn(`O usuário ${role} existe, mas ${variable} não está no .env. Preencha-o ou apague .data e .env para recriar o banco de desenvolvimento.`);
    return false;
  }
  /** Cria o schema com o SQL dele, ou só refaz as permissões se um usuário novo apareceu. Os arquivos SQL não levam o schema nas tabelas. */
  async function ensureSchema(schema: string, files: { schema: string; grants: string }, newRole: boolean) {
    const exists = (await admin.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schema])).rows.length > 0;
    if (exists && !newRole) return;
    if (!exists) await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path = ${schema}`);
    if (!exists) await admin.query(sqlOf(files.schema));
    await admin.query(sqlOf(files.grants));
    await admin.query("RESET search_path");
    added.push(exists ? `permissões de ${schema}` : `schema ${schema}`);
  }

  let portalNew = false;
  for (const [role, variable] of PORTAL_ROLES) portalNew = (await ensureRole(role, variable)) || portalNew;
  await ensureSchema(PORTAL_SCHEMA, { schema: "server/sql/portal_schema.sql", grants: "server/sql/portal_grants.sql" }, portalNew);
  // Portal que já existia sem as categorias: acrescenta as tabelas e as permissões, sem tocar em pessoas, sessões nem acessos.
  const hasCategories = (await admin.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'category'", [PORTAL_SCHEMA])).rows.length > 0;
  if (!hasCategories) {
    await admin.query(`SET search_path = ${PORTAL_SCHEMA}`);
    await admin.query(sqlOf("server/sql/portal_upgrade_categories.sql"));
    await admin.query("RESET search_path");
    added.push("categorias do portal");
  }
  for (const dashboard of DASHBOARDS) {
    const db = dashboard.db;
    const created = [await ensureRole(readerRole(db), dashboardEnv(db, "DATABASE_URL")), await ensureRole(loaderRole(db), dashboardEnv(db, "LOAD_DATABASE_URL"))].some(Boolean);
    await ensureSchema(db.schema, { schema: `dashboards/${dashboard.slug}/sql/001_schema.sql`, grants: `dashboards/${dashboard.slug}/sql/002_grants.sql` }, created);
  }
  await admin.end();
  if (newUrls.length) appendFileSync(ENV_FILE, `${newUrls.join("\n")}\n`);
  return added;
}

if (await running()) {
  const added = await ensure(adminPassword);
  console.log(added.length ? `O banco de desenvolvimento já estava no ar. Acrescentado: ${added.join(", ")}.` : "O banco de desenvolvimento já está no ar e completo. Nada foi alterado.");
  process.exit(0);
}

const { default: EmbeddedPostgres } = await import("embedded-postgres");
const server = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "dev_admin",
  password: adminPassword,
  port: PORT,
  persistent: true,
  // Sem isso, o texto vem com a codificação do sistema, e os acentos quebram.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (firstRun) await server.initialise();
await server.start();

if (firstRun) {
  await server.createDatabase("dashboard");
  writeFileSync(ENV_FILE, [
    `DEV_ADMIN_PASSWORD=${adminPassword}`,
    `DEV_DB_PORT=${PORT}`,
    "AUTH_MODE=local",
    "PORT=8787",
    "",
  ].join("\n"));
}
const added = await ensure(adminPassword);
if (added.length) console.log(`Banco de desenvolvimento preparado: ${added.join(", ")}. Credenciais gravadas em .env.`);

console.log(`Postgres de desenvolvimento em 127.0.0.1:${PORT}. Ctrl+C para parar.`);

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
