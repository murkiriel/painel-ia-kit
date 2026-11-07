// SQLite pelo node:sqlite, que já vem no Node. Serve uma máquina, com um escritor por vez, e bloqueia o processo
// durante cada consulta: os limites e os tempos medidos estão no README.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { constants, DatabaseSync } from "node:sqlite";
import { divide, scaledText, sortKey, toScaled } from "./decimal.ts";
import { DatabaseUnavailable, type Db } from "./types.ts";

const { SQLITE_DELETE, SQLITE_DENY, SQLITE_FUNCTION, SQLITE_INSERT, SQLITE_OK, SQLITE_READ, SQLITE_SELECT, SQLITE_TRANSACTION, SQLITE_UPDATE } = constants;

export const FULL = [SQLITE_INSERT, SQLITE_UPDATE, SQLITE_DELETE];
export { SQLITE_DELETE as DELETE, SQLITE_INSERT as INSERT, SQLITE_UPDATE as UPDATE };

/**
 * O que uma conexão pode fazer. O SQLite não tem usuários: estas permissões valem por conexão e repetem as de cada
 * 002_grants.sql, com a mesma separação. Sem Access (null), a conexão é de administração e nunca é usada pelo servidor.
 */
export type Access = {
  /** Abre o arquivo somente para leitura e liga query_only: uma segunda trava, além da lista. */
  readOnly?: boolean;
  /** Tabelas que precisam existir. Faltando alguma, a conexão não abre e a tela avisa. */
  required: string[];
  read: string[];
  write: Record<string, number[]>;
  transactions?: boolean;
};

/** Tudo que não está na lista é negado: outra tabela, PRAGMA, ATTACH, CREATE, DROP. */
function authorizer(grant: Access) {
  return (action: number, table: string | null) => {
    if (action === SQLITE_SELECT || action === SQLITE_FUNCTION) return SQLITE_OK;
    if (action === SQLITE_READ) return table === "json_each" || grant.read.includes(table ?? "") ? SQLITE_OK : SQLITE_DENY;
    if (action === SQLITE_TRANSACTION) return grant.transactions ? SQLITE_OK : SQLITE_DENY;
    return grant.write[table ?? ""]?.includes(action) ? SQLITE_OK : SQLITE_DENY;
  };
}

const NOT_CREATED = "O banco de dados ainda não foi criado. Quem administra o dashboard precisa rodar npm run db e npm run load.";
const NO_TABLES = "O banco de dados está sem as tabelas. Quem administra o dashboard precisa rodar npm run db e npm run load.";
const INVALID = "O arquivo do banco de dados não pôde ser lido. Quem administra o dashboard precisa conferir o arquivo.";

const readScales = (db: DatabaseSync) =>
  Object.fromEntries(db.prepare("SELECT column_name, scale FROM numeric_scale").all().map((row) => [row.column_name as string, Number(row.scale)]));

/** As contas que o Postgres faz em NUMERIC. Recebem os inteiros guardados e devolvem texto, com BigInt. */
function registerFunctions(db: DatabaseSync, scales: Record<string, number>) {
  const options = { deterministic: true, useBigIntArguments: true };
  const big = (value: unknown) => BigInt(value as bigint | string);
  const scaleOf = (column: unknown) => {
    const scale = scales[String(column)];
    if (scale === undefined) throw new Error(`Coluna sem escala: ${column}.`);
    return scale;
  };
  // A soma de inteiros do SQLite dá erro ao passar de 64 bits. Esta não tem limite, e devolve texto.
  db.aggregate("dec_sum", {
    ...options,
    start: null,
    step: (sum: unknown, value: unknown) => (value === null ? sum : ((sum as bigint | null) ?? 0n) + big(value)) as never,
    inverse: (sum: unknown, value: unknown) => (value === null ? sum : (sum as bigint) - big(value)) as never,
    result: (sum: unknown) => (sum === null ? null : String(sum)),
  });
  db.function("dec_sub", options, (a, b) => (a === null || b === null ? null : String(big(a) - big(b))));
  db.function("dec_sort", options, (value) => (value === null ? null : sortKey(big(value))));
  db.function("dec_text", options, (value, column) => (value === null ? null : scaledText(big(value), scaleOf(column))));
  // Divisão por zero vira nulo, como NULLIF(b, 0) nas consultas do Postgres.
  const quotient = (a: unknown, b: unknown, column: unknown) => (a === null || b === null || big(b) === 0n ? null : divide(big(a), big(b), scaleOf(column)));
  db.function("dec_div", options, (a, b, column) => {
    const result = quotient(a, b, column);
    return result && scaledText(result.quotient, result.scale);
  });
  db.function("dec_variation", options, (a, b, column) => {
    const result = quotient(a, b, column);
    return result && scaledText(result.quotient - 10n ** BigInt(result.scale), result.scale);
  });
  // Sem ICU no SQLite, a consulta recebe os nomes já em ordem de dicionário, e esta função dá a posição de cada um.
  let ranked = "";
  let ranks = new Map<string, number>();
  db.function("pt_rank", { deterministic: true }, (name, list) => {
    if (list !== ranked) {
      ranked = String(list);
      ranks = new Map((JSON.parse(ranked) as string[]).map((item, position) => [item, position]));
    }
    return ranks.get(String(name)) ?? null;
  });
}

function open(file: string, access: Access | null): DatabaseSync {
  if (!existsSync(file)) throw new DatabaseUnavailable(NOT_CREATED);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: access?.readOnly === true, timeout: 5000, ...(access === null ? {} : { limits: { attach: 0 } }) });
    const found = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (access && access.required.some((table) => !found.has(table))) throw new DatabaseUnavailable(NO_TABLES);
    registerFunctions(db, found.has("numeric_scale") ? readScales(db) : {});
    // Segunda trava da leitura: sem isso, tabela temporária ainda seria aceita.
    if (access?.readOnly) db.exec("PRAGMA query_only = ON");
    if (access) {
      // A permissão por conexão é parte da segurança: sem ela, melhor não abrir.
      if (typeof db.setAuthorizer !== "function") throw new Error("Esta versão do Node não tem setAuthorizer: use a do README.");
      db.setAuthorizer(authorizer(access));
    }
    return db;
  } catch (error) {
    db?.close();
    if (error instanceof DatabaseUnavailable) throw error;
    console.error(`SQLite, ${file}:`, error instanceof Error ? error.message : error);
    throw new DatabaseUnavailable(INVALID);
  }
}

const toParam = (value: unknown) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  // Número do JavaScript entra como real. Inteiro precisa entrar como inteiro.
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  return (value ?? null) as null | string | number | bigint;
};

/**
 * A pequena tradução do SQL do Postgres, igual em toda consulta: filtro opcional, lista permitida e parâmetro sem tipo.
 * O resto da diferença fica às claras, ao lado da versão do Postgres, em server/domain/queries.ts.
 * Qualquer outro "::" chega ao SQLite e dá erro de sintaxe, em vez de mudar de sentido em silêncio.
 */
export const toSqlite = (text: string, values: unknown[] = []) =>
  text
    // O Postgres olha o valor do parâmetro ao planejar. O SQLite não: com o OR, ele nunca usaria o índice.
    .replace(/\((\$(\d+))::\w+ IS NULL OR ([\w.]+) = \$\2::\w+\)/g, (_, param, position, column) => ((values[Number(position) - 1] ?? null) === null ? "1" : `${column} = ${param}`))
    .replace(/= ANY\((\$\d+)::text\[\]\)/g, "IN (SELECT value FROM json_each($1))")
    .replace(/(\$\d+)::\w+/g, "$1")
    .replace(/::int\b/g, "");

export type SqliteDb = Db & { handle(): DatabaseSync };

/** A conexão abre na primeira consulta: se o arquivo ainda não existe, a tela avisa, e funciona depois da carga, sem reiniciar. */
export function openSqlite(file: string, access: Access | null): SqliteDb {
  let db: DatabaseSync | null = null;
  const handle = () => (db ??= open(file, access));
  return {
    engine: "sqlite",
    handle,
    async query(text, values = []) {
      const sql = toSqlite(text, values);
      const bound: Record<string, null | string | number | bigint> = {};
      for (const name of new Set(sql.match(/\$\d+/g) ?? [])) bound[name] = toParam(values[Number(name.slice(1)) - 1]);
      try {
        return { rows: handle().prepare(sql).all(bound) };
      } catch (error) {
        if (error instanceof Error && /no such table/.test(error.message)) {
          db?.close();
          db = null;
          console.error(`SQLite, ${file}:`, error.message);
          throw new DatabaseUnavailable(NO_TABLES);
        }
        throw error;
      }
    },
    async end() {
      db?.close();
      db = null;
    },
  };
}

/**
 * Cria o arquivo e as tabelas, com os arquivos SQL na ordem. Valores com mais casas pedem uma escala maior,
 * definida aqui, com a tabela vazia: valueScale vale para a coluna value_brl, quando o arquivo tem numeric_scale.
 */
export function createSqliteFile(file: string, { sql, valueScale }: { sql: string[]; valueScale?: number }) {
  if (existsSync(file)) throw new Error(`O banco já existe: ${file}. Para recriar, apague o arquivo e repita.`);
  if (valueScale !== undefined && (!Number.isInteger(valueScale) || valueScale < 0 || valueScale > 12)) throw new Error("SQLITE_VALUE_SCALE precisa ser um inteiro de 0 a 12.");
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  // Com WAL, quem lê não espera quem escreve: a tela continua respondendo durante a carga.
  db.exec("PRAGMA journal_mode = WAL");
  for (const sqlFile of sql) db.exec(readFileSync(sqlFile, "utf8"));
  if (valueScale !== undefined && (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'numeric_scale'").get())) {
    db.prepare("UPDATE numeric_scale SET scale = ? WHERE column_name = 'value_brl'").run(valueScale);
  }
  db.close();
}

/** Grava linhas em uma tabela. Colunas com escala viram inteiro, sem passar por ponto flutuante. Quem chama abre a transação. */
export function writeRows(db: DatabaseSync, table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const scales = readScales(db);
  const columns = Object.keys(rows[0]);
  const insert = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
  for (const row of rows) insert.run(...columns.map((column) => (Object.hasOwn(scales, column) ? toScaled(row[column], scales[column]) : toParam(row[column]))));
}
