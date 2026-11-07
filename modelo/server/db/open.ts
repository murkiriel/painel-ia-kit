// Escolha do banco, no .env, em um lugar só. Postgres é o padrão. O node:sqlite só é carregado quando o SQLite é escolhido.
//
// Um banco por projeto. No Postgres, cada dashboard tem o próprio schema, e o portal (usuários, sessões e acessos) tem o dele.
// No SQLite, cada dashboard tem um arquivo, e o portal tem outro, todos na mesma pasta.
import path from "node:path";
import pg from "pg";
import { DELETE, FULL, INSERT, UPDATE, type Access } from "./sqlite.ts";
import type { Db } from "./types.ts";

export type Engine = "postgres" | "sqlite";

/** O que o banco precisa saber de um dashboard: onde ele mora e o que cada função pode tocar. */
export type DashboardDb = {
  slug: string;
  /** Schema do Postgres. */
  schema: string;
  /** Tabelas que a consulta, inclusive a do agente, pode ler. */
  readTables: string[];
  /** Tabelas que a carga escreve. */
  loadTables: string[];
};

export const PORTAL_SCHEMA = "portal";
export const PORTAL_TABLES = ["app_user", "app_session", "dashboard_access"];
/** As categorias de dashboards: o login só lê, e a administração grava. */
export const CATEGORY_TABLES = ["category", "dashboard_category"];
export const DEFAULT_SQLITE_DIR = ".data";

/** Vazio é o padrão, Postgres. Valor desconhecido impede de subir: um erro de digitação não pode trocar de banco. */
export function readEngine(value: string | undefined): Engine {
  if (!value || value === "postgres") return "postgres";
  if (value === "sqlite") return "sqlite";
  throw new Error('DB_ENGINE inválido: use "postgres" ou "sqlite", ou deixe vazio para usar o Postgres.');
}

/** Pasta dos dados locais: miniaturas e, no SQLite, os arquivos. DATA_DIR muda de lugar; SQLITE_DIR muda só os arquivos do SQLite. */
export const dataDir = () => process.env.DATA_DIR || DEFAULT_SQLITE_DIR;
export const sqliteDir = () => process.env.SQLITE_DIR || dataDir();
/** O arquivo do portal ("portal") ou de um dashboard (o slug). */
export const sqliteFile = (name: string) => path.join(sqliteDir(), `${name}.sqlite`);
export const portalName = "portal";

/**
 * Cada dashboard tem os próprios usuários de banco, de leitura e de carga, só com permissão no schema dele: o banco recusa
 * qualquer consulta que tente tocar os dados de outro. Os nomes seguem o schema: <schema>_reader e <schema>_loader.
 */
export const readerRole = (db: DashboardDb) => `${db.schema}_reader`;
export const loaderRole = (db: DashboardDb) => `${db.schema}_loader`;
/** Variável do .env com o endereço do banco de um dashboard: PRODUCAO_AGRICOLA_DATABASE_URL (leitura) ou ..._LOAD_DATABASE_URL (carga). */
export const dashboardEnv = (db: DashboardDb, kind: "DATABASE_URL" | "LOAD_DATABASE_URL") => `${db.schema.toUpperCase()}_${kind}`;

const isSqlite = () => readEngine(process.env.DB_ENGINE) === "sqlite";

/** A consulta lê só os dados, e o arquivo abre somente para leitura. */
export const readerAccess = (db: DashboardDb): Access => ({ readOnly: true, required: ["numeric_scale", ...db.readTables], read: db.readTables, write: {} });

/** A carga escreve só nas tabelas de dados e no log. */
export const loaderAccess = (db: DashboardDb): Access => ({
  required: ["numeric_scale", ...db.loadTables],
  read: [...db.loadTables, "numeric_scale"],
  write: Object.fromEntries(db.loadTables.map((table) => [table, FULL])),
  transactions: true,
});

// Login: lê usuários e acessos e cuida das sessões. Não enxerga os dados dos dashboards.
const authAccess: Access = { required: [...PORTAL_TABLES, ...CATEGORY_TABLES], read: [...PORTAL_TABLES, ...CATEGORY_TABLES], write: { app_session: [INSERT, DELETE] } };
// Administração do portal: cria e altera usuários e acessos. Só roda depois de o servidor confirmar que quem pede é administrador.
const portalAccess: Access = {
  required: [...PORTAL_TABLES, ...CATEGORY_TABLES],
  read: [...PORTAL_TABLES, ...CATEGORY_TABLES],
  write: { app_user: [INSERT, UPDATE], dashboard_access: FULL, app_session: [DELETE], category: FULL, dashboard_category: FULL },
  transactions: true,
};
// Primeiro login: só cria o usuário, em uma conexão aberta para isso e fechada em seguida. Lê as sessões porque a chave estrangeira obriga.
const firstUserAccess: Access = { required: PORTAL_TABLES, read: PORTAL_TABLES, write: { app_user: [INSERT] } };

const openSqliteAccess = async (name: string, access: Access | null) => {
  const { openSqlite } = await import("./sqlite.ts");
  return openSqlite(sqliteFile(name), access);
};

function pool(options: pg.PoolConfig, schema: string): Db {
  // Sem o schema na frente, as consultas de cada dashboard (escritas sem prefixo) achariam as tabelas de outro.
  const created = new pg.Pool({ ...options, options: `-c search_path=${schema}` });
  // Conexão ociosa que cai emite "error". Sem este tratamento, o processo inteiro cairia.
  created.on("error", (error) => console.error("Conexão com o banco:", error.message));
  return created as unknown as Db;
}

/** Consulta de um dashboard, inclusive a do agente. No Postgres, usuário só de leitura; no SQLite, conexão somente para leitura. */
export const openReader = async (db: DashboardDb): Promise<Db> =>
  isSqlite() ? openSqliteAccess(db.slug, readerAccess(db)) : pool({ connectionString: process.env[dashboardEnv(db, "DATABASE_URL")], max: 8, statement_timeout: 15_000 }, db.schema);

/** Login: só as tabelas do portal. */
export const openAuth = async (): Promise<Db> =>
  isSqlite() ? openSqliteAccess(portalName, authAccess) : pool({ connectionString: process.env.AUTH_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 }, PORTAL_SCHEMA);

/** Administração do portal: pessoas, acessos e troca de senha. */
export const openPortal = async (): Promise<Db> =>
  isSqlite() ? openSqliteAccess(portalName, portalAccess) : pool({ connectionString: process.env.PORTAL_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 }, PORTAL_SCHEMA);

/** Só no SQLite, que não tem função no banco: a conexão que cria o primeiro login. */
export const openFirstUser = async (): Promise<Db> => openSqliteAccess(portalName, firstUserAccess);

/** Criar usuários e preparar provas. Nunca é usado pelo servidor. "portal" ou o slug de um dashboard. */
export async function openAdmin(name: string = portalName, schema?: string): Promise<Db> {
  if (isSqlite()) return openSqliteAccess(name, null);
  const port = process.env.DEV_DB_PORT || "54329";
  const connectionString = process.env.ADMIN_DATABASE_URL || `postgres://dev_admin:${process.env.DEV_ADMIN_PASSWORD}@127.0.0.1:${port}/dashboard`;
  const client = new pg.Client({ connectionString, options: `-c search_path=${schema ?? (name === portalName ? PORTAL_SCHEMA : name.replaceAll("-", "_"))}` });
  await client.connect();
  return client as unknown as Db;
}
