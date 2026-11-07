// A interface mínima que as consultas usam. O pg.Pool já é assim; o SQLite cabe nela em server/db/sqlite.ts.

export type Db = {
  /** Só o SQLite preenche. Sem o campo, é Postgres. */
  engine?: "sqlite";
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
};

/** O banco ainda não pode responder: arquivo ausente ou sem tabelas. A mensagem vai para a tela, sem caminho nem SQL. */
export class DatabaseUnavailable extends Error {}
