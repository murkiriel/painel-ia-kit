// Onde a carga grava, um banco de cada vez, com as duas versões lado a lado.
// Nos dois, a troca é uma transação só: se algo falhar, o dado anterior continua no ar.
import pg from "pg";
import { dashboardEnv, loaderAccess, readEngine, sqliteFile } from "../../../server/db/open.ts";
import { DB } from "../db.ts";
import type { Prepared } from "./prepare.ts";
import type { Production } from "./sidra.ts";

export type LoadStore = {
  /** Impede duas cargas ao mesmo tempo. Devolve false se já há uma em andamento. */
  lock(): Promise<boolean>;
  start(): Promise<unknown>;
  replace(logId: unknown, prepared: Prepared): Promise<void>;
  fail(logId: unknown, message: string): Promise<void>;
  close(): Promise<void>;
};

const LOCK_ID = 5457;

const insertRaw = `
  INSERT INTO raw_production (year, state_code, state_name, variable, unit, crop_code, crop_name, raw_value)
  SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])`;

const insertProduction = `
  INSERT INTO production (year, state_code, state_name, region, crop_code, crop_name, value_brl, quantity_t, quantity_unit, area_ha)
  SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::text[], $10::numeric[])`;

// Com o mês ligado (server/sql/optional_month.sql).
const insertProductionByMonth = `
  INSERT INTO production (year, state_code, state_name, region, crop_code, crop_name, value_brl, quantity_t, quantity_unit, area_ha, month)
  SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::text[], $10::numeric[], $11::int[])`;

/**
 * Com a coluna month, toda linha precisa trazer o mês, para nenhuma cair em um mês errado ou recusada pelo banco no meio da carga.
 * Sem a coluna, o mês não tem onde ficar, e a linha que o traz é recusada, em vez de somar meses em silêncio.
 */
export function checkMonths(production: Production[], hasColumn: boolean) {
  const withMonth = production.filter((row) => row.month !== undefined && row.month !== null).length;
  if (hasColumn && withMonth < production.length) throw new Error(`A tabela production tem a coluna month, e a carga trouxe linhas sem o mês: ${production.length - withMonth} de ${production.length}. Veja "Ligar o mês" no README.`);
  if (!hasColumn && withMonth > 0) throw new Error(`A carga trouxe linhas com o mês, ${withMonth} de ${production.length}, e a tabela production não tem a coluna month. Veja "Ligar o mês" no README.`);
}

const insertNational = `
  INSERT INTO source_national (year, crop_code, value_brl, quantity_t, area_ha)
  SELECT * FROM unnest($1::int[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[])`;

export async function postgresStore(connectionString: string | undefined): Promise<LoadStore> {
  // O schema do dashboard na frente: as consultas não levam prefixo.
  const client = new pg.Client({ connectionString, options: `-c search_path=${DB.schema}` });
  await client.connect();
  return {
    lock: async () => (await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_ID])).rows[0].ok,
    start: async () => (await client.query("INSERT INTO load_log (entity, started_at, status) VALUES ('production', now(), 'running') RETURNING id")).rows[0].id,
    async replace(logId, { raw, production, national }) {
      try {
        const hasMonth = (await client.query("SELECT 1 FROM pg_attribute WHERE attrelid = 'production'::regclass AND attname = 'month' AND NOT attisdropped")).rows.length > 0;
        checkMonths(production, hasMonth);
        await client.query("BEGIN");
        await client.query("DELETE FROM raw_production");
        await client.query("DELETE FROM production");
        await client.query("DELETE FROM source_national");
        await client.query(insertRaw, [
          raw.map((r) => Number(r.D3N)), raw.map((r) => r.D1C), raw.map((r) => r.D1N), raw.map((r) => r.D2C),
          raw.map((r) => r.MN), raw.map((r) => r.D4C), raw.map((r) => r.D4N), raw.map((r) => r.V),
        ]);
        await client.query(hasMonth ? insertProductionByMonth : insertProduction, [
          production.map((p) => p.year), production.map((p) => p.state_code), production.map((p) => p.state_name),
          production.map((p) => p.region), production.map((p) => p.crop_code), production.map((p) => p.crop_name),
          production.map((p) => p.value_brl), production.map((p) => p.quantity_t), production.map((p) => p.quantity_unit),
          production.map((p) => p.area_ha), ...(hasMonth ? [production.map((p) => p.month)] : []),
        ]);
        await client.query(insertNational, [
          national.map((n) => n.year), national.map((n) => n.crop_code), national.map((n) => n.value_brl),
          national.map((n) => n.quantity_t), national.map((n) => n.area_ha),
        ]);
        await client.query(
          "UPDATE load_log SET finished_at = now(), status = 'ok', rows_read = $2, rows_saved = $3, rows_rejected = 0 WHERE id = $1",
          [logId, raw.length, production.length],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    fail: async (logId, message) => void (await client.query("UPDATE load_log SET finished_at = now(), status = 'error', error = $2 WHERE id = $1", [logId, message])),
    close: () => client.end(),
  };
}

/** A conexão de carga não pode ler a descrição das tabelas, mas pode perguntar pela coluna. */
function columnExists(db: { prepare(sql: string): unknown }, table: string, column: string) {
  try {
    db.prepare(`SELECT ${column} FROM ${table} LIMIT 0`);
    return true;
  } catch (error) {
    if (error instanceof Error && /no such column/.test(error.message)) return false;
    throw error;
  }
}

export async function sqliteStore(file: string): Promise<LoadStore> {
  const { rmSync } = await import("node:fs");
  const { DatabaseSync } = await import("node:sqlite");
  const { openSqlite, writeRows } = await import("../../../server/db/sqlite.ts");
  const connection = openSqlite(file, loaderAccess(DB));
  const db = connection.handle();
  const now = () => new Date().toISOString();
  const lockFile = `${file}.load-lock`;
  let lockDb: InstanceType<typeof DatabaseSync> | null = null;
  return {
    // O SQLite não tem o bloqueio de sessão do Postgres. Um arquivo à parte fica preso durante a carga; se o processo cair, o sistema solta.
    async lock() {
      const candidate = new DatabaseSync(lockFile, { timeout: 0 });
      try {
        candidate.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE");
        lockDb = candidate;
        return true;
      } catch {
        candidate.close();
        return false;
      }
    },
    start: async () => db.prepare("INSERT INTO load_log (entity, started_at, status) VALUES ('production', ?, 'running')").run(now()).lastInsertRowid,
    async replace(logId, { raw, production, national }) {
      checkMonths(production, columnExists(db, "production", "month"));
      // Quem lê continua vendo o dado anterior até o COMMIT.
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DELETE FROM raw_production; DELETE FROM production; DELETE FROM source_national");
        writeRows(db, "raw_production", raw.map((r) => ({
          year: Number(r.D3N), state_code: r.D1C, state_name: r.D1N, variable: r.D2C, unit: r.MN, crop_code: r.D4C, crop_name: r.D4N, raw_value: r.V,
        })));
        writeRows(db, "production", production);
        writeRows(db, "source_national", national);
        db.prepare("UPDATE load_log SET finished_at = ?, status = 'ok', rows_read = ?, rows_saved = ?, rows_rejected = 0 WHERE id = ?").run(now(), raw.length, production.length, logId as bigint);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    fail: async (logId, message) => void db.prepare("UPDATE load_log SET finished_at = ?, status = 'error', error = ? WHERE id = ?").run(now(), message, logId as bigint),
    async close() {
      await connection.end();
      if (!lockDb) return;
      lockDb.close();
      // Só quem segurou o bloqueio apaga o arquivo. Outra carga pode já estar abrindo-o, e tudo bem se ele ficar.
      try {
        rmSync(lockFile, { force: true });
      } catch {}
    },
  };
}

export const openLoadStore = () =>
  readEngine(process.env.DB_ENGINE) === "sqlite" ? sqliteStore(sqliteFile(DB.slug)) : postgresStore(process.env[dashboardEnv(DB, "LOAD_DATABASE_URL")]);
