// Prova as travas de banco do projeto: o que cada função (consulta, carga, login, administração) pode e não pode tocar.
// Rode com o banco de desenvolvimento no ar. Nenhuma tentativa de escrita altera dados: todas precisam falhar.
// As travas de rota e as consultas de cada dashboard ficam na pasta dele: npm run dash -- check-security <slug>.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { DASHBOARDS } from "../server/dashboards.ts";
import { openAuth, openPortal, openReader, portalName, readEngine, sqliteFile } from "../server/db/open.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const sqlite = readEngine(process.env.DB_ENGINE) === "sqlite";
// O SQLite registra no erro padrão cada tabela que não achou: aqui isso é o esperado, e só poluiria a saída.
const reportError = console.error;
console.error = (...args: unknown[]) => { if (!String(args[0]).startsWith("SQLite,")) reportError(...args); };
const who = sqlite ? "conexão" : "usuário";
const REFUSED = sqlite ? /readonly|not authorized|authorization denied|prohibited|too many attached/ : /permission denied|must be owner/;
// Uma tabela que não está no arquivo do dashboard (SQLite) também é "sem acesso": quem lê não a enxerga.
const NO_ACCESS = sqlite ? /not authorized|prohibited|no such table|sem as tabelas|ainda não foi criado/ : /permission denied/;

// No SQLite, a prova inclui os bytes dos arquivos: o hash não muda depois de todas as tentativas. Arquivo -wal vazio (criado ao abrir) não conta.
const files = [portalName, ...DASHBOARDS.map((d) => d.slug)].map(sqliteFile);
const fileHash = () => files.flatMap((file) => [file, `${file}-wal`]).filter((file) => existsSync(file) && statSync(file).size > 0).map((file) => createHash("sha256").update(readFileSync(file)).digest("hex")).join();
const hashBefore = sqlite ? fileHash() : "";
if (sqlite) console.log("Não se aplica ao SQLite: TRUNCATE (o comando não existe nele; o DELETE é o equivalente) e usuários de banco (a separação é por conexão, e quem abre o arquivo com outro programa passa por cima: proteja a pasta).");

// O nome da tabela de dados de cada dashboard, com o schema na frente no Postgres, para a tentativa não depender do search_path.
const dataTable = (dashboard: (typeof DASHBOARDS)[number], table: string) => (sqlite ? table : `${dashboard.db.schema}.${table}`);

// Um dashboard só de Postgres não tem arquivo em SQLite: não se aplica.
const checked = DASHBOARDS.filter((dashboard) => !(sqlite && dashboard.postgresOnly));
if (checked.length < DASHBOARDS.length) console.log(`Não se aplica ao SQLite: ${DASHBOARDS.filter((d) => !checked.includes(d)).map((d) => d.slug).join(", ")} (só Postgres).`);

for (const dashboard of checked) {
  const reader = await openReader(dashboard.db);
  const table = dashboard.db.readTables[0];
  for (const sql of [
    `INSERT INTO ${table} DEFAULT VALUES`, `DELETE FROM ${table}`, ...(sqlite ? [] : [`TRUNCATE ${table}`]), `DROP TABLE ${table}`, "CREATE TABLE teste (id int)",
    ...(sqlite ? ["CREATE TEMP TABLE teste (id int)", "ATTACH DATABASE 'teste.sqlite' AS teste", "VACUUM", "PRAGMA query_only = OFF", "PRAGMA writable_schema = ON"] : []),
  ]) {
    await assert.rejects(reader.query(sql), REFUSED, `${dashboard.slug}: a consulta conseguiu: ${sql}`);
  }
  console.log(`OK, ${who} de consulta de ${dashboard.slug} não escreve nem muda a estrutura.`);
  // O portal mora em outro lugar: o leitor de um dashboard não lê pessoas, sessões nem acessos.
  for (const portalTable of ["app_user", "app_session", "dashboard_access", "category", "dashboard_category"]) {
    await assert.rejects(reader.query(`SELECT * FROM ${sqlite ? portalTable : `portal.${portalTable}`}`), NO_ACCESS, `${dashboard.slug} leu ${portalTable}`);
  }
  console.log(`OK, ${who} de consulta de ${dashboard.slug} não lê o portal (pessoas, sessões e acessos).`);
  // Cada dashboard tem os próprios dados: o leitor de um não lê, nem escreve, o schema (ou o arquivo) de outro.
  for (const other of checked.filter((d) => d.slug !== dashboard.slug)) {
    if (sqlite) {
      // Cada dashboard é um arquivo, aberto sozinho: o outro só apareceria por ATTACH, que é proibido.
      await assert.rejects(reader.query(`ATTACH DATABASE '${sqliteFile(other.slug).replaceAll("\\", "/")}' AS outro`), REFUSED, `${dashboard.slug} anexou o arquivo de ${other.slug}`);
    } else {
      for (const otherTable of other.db.readTables) {
        await assert.rejects(reader.query(`SELECT * FROM ${other.db.schema}.${otherTable} LIMIT 1`), NO_ACCESS, `${dashboard.slug} leu ${other.slug}.${otherTable}`);
      }
      await assert.rejects(reader.query(`DELETE FROM ${other.db.schema}.${other.db.readTables[0]}`), NO_ACCESS, `${dashboard.slug} apagou em ${other.slug}`);
    }
    console.log(`OK, ${who} de consulta de ${dashboard.slug} não toca nos dados de ${other.slug}.`);
  }
  await reader.end();
}

const auth = await openAuth();
const portal = await openPortal();
for (const dashboard of checked) {
  for (const [name, connection] of [["login", auth], ["administração", portal]] as const) {
    for (const table of dashboard.db.readTables) {
      await assert.rejects(connection.query(`SELECT * FROM ${dataTable(dashboard, table)} LIMIT 1`), NO_ACCESS, `${name} leu ${dashboard.slug}.${table}`);
    }
    await assert.rejects(connection.query(`DELETE FROM ${dataTable(dashboard, dashboard.db.readTables[0])}`), NO_ACCESS);
  }
}
console.log(`OK, ${who} de login e de administração do portal não enxergam os dados de nenhum dashboard.`);

await assert.rejects(auth.query("UPDATE app_user SET name = 'x'"), NO_ACCESS);
await assert.rejects(auth.query("DELETE FROM app_user"), NO_ACCESS);
await assert.rejects(auth.query("INSERT INTO app_user (login, name, pass_hash, pass_salt, is_admin) VALUES ('x', 'x', 'x', 'x', TRUE)"), NO_ACCESS);
await assert.rejects(auth.query("UPDATE app_user SET is_admin = TRUE"), NO_ACCESS);
await assert.rejects(auth.query("INSERT INTO dashboard_access (user_id, dashboard, full_access) VALUES (1, 'x', TRUE)"), NO_ACCESS);
await assert.rejects(auth.query("UPDATE dashboard_access SET full_access = TRUE"), NO_ACCESS);
await assert.rejects(auth.query("DELETE FROM dashboard_access"), NO_ACCESS);
await assert.rejects(auth.query("UPDATE app_session SET csrf = 'x'"), NO_ACCESS);
await assert.rejects(auth.query("DROP TABLE app_session"), REFUSED);
// Categorias: o login só lê (para agrupar os cartões) e não grava.
assert.ok(Array.isArray((await auth.query("SELECT id, name FROM category")).rows));
await assert.rejects(auth.query("INSERT INTO category (name, position) VALUES ('x', 1)"), NO_ACCESS);
await assert.rejects(auth.query("UPDATE category SET name = 'x'"), NO_ACCESS);
await assert.rejects(auth.query("DELETE FROM category"), NO_ACCESS);
await assert.rejects(auth.query("INSERT INTO dashboard_category (dashboard, category_id) VALUES ('x', 1)"), NO_ACCESS);
await assert.rejects(auth.query("DELETE FROM dashboard_category"), NO_ACCESS);
console.log(`OK, ${who} de login só lê pessoas e acessos, e nas sessões só cria e apaga: não cria nem altera pessoa nem acesso.`);

await assert.rejects(portal.query("INSERT INTO app_session (token, csrf, user_id, expires_at) VALUES ('x', 'x', 1, '2099-01-01')"), NO_ACCESS);
await assert.rejects(portal.query("UPDATE app_session SET csrf = 'x'"), NO_ACCESS);
await assert.rejects(portal.query("DELETE FROM app_user"), NO_ACCESS);
await assert.rejects(portal.query("DROP TABLE app_user"), REFUSED);
// Categorias: a administração grava, e só nelas, sem mudar a estrutura.
await assert.rejects(portal.query("DROP TABLE category"), REFUSED);
await assert.rejects(portal.query("DROP TABLE dashboard_category"), REFUSED);
await assert.rejects(portal.query("CREATE TABLE teste (id int)"), REFUSED);
console.log(`OK, ${who} de administração do portal não cria sessão, não apaga pessoa e não muda a estrutura.`);

if (!sqlite && (await auth.query("SELECT 1 FROM app_user LIMIT 1")).rows.length > 0) {
  // Só com pessoas na tabela: com ela vazia, a função criaria de fato o primeiro login.
  // No Postgres, só a função cria a primeira pessoa, e a de login não grava em app_user por conta própria.
  const attempt = await auth.query("SELECT portal.create_first_user('teste_invasor', 'x', 'x', 'x') AS created").then((r) => r.rows[0].created);
  assert.equal(attempt, false, "com pessoas na tabela, a função não cria nada");
  console.log("OK, com pessoas na tabela, a função do primeiro login não cria ninguém.");
}

if (sqlite) {
  assert.equal(fileHash(), hashBefore);
  console.log("OK, os arquivos dos bancos não mudaram: o hash é o mesmo depois de todas as tentativas.");
}

await auth.end();
await portal.end();
console.log("Travas de banco conferidas.");
