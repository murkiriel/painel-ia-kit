// Leitura do CSV mensal de arrecadação da Receita, só para a prova do mês (scripts/check-month.ts).
// Não faz parte do exemplo. Cada coluna de tributo do arquivo entra no lugar de uma lavoura.
// Qualquer coisa fora do previsto recusa o arquivo: carga parcial parece correta e não é.
import { producaoAgricola } from "../dashboards/producao-agricola/dashboard.ts";
import { loaderRole, readerRole } from "../server/db/open.ts";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const STATES: Record<string, { code: string; name: string; region: string }> = {
  RO: { code: "11", name: "Rondônia", region: "Norte" }, AC: { code: "12", name: "Acre", region: "Norte" },
  AM: { code: "13", name: "Amazonas", region: "Norte" }, RR: { code: "14", name: "Roraima", region: "Norte" },
  PA: { code: "15", name: "Pará", region: "Norte" }, AP: { code: "16", name: "Amapá", region: "Norte" },
  TO: { code: "17", name: "Tocantins", region: "Norte" }, MA: { code: "21", name: "Maranhão", region: "Nordeste" },
  PI: { code: "22", name: "Piauí", region: "Nordeste" }, CE: { code: "23", name: "Ceará", region: "Nordeste" },
  RN: { code: "24", name: "Rio Grande do Norte", region: "Nordeste" }, PB: { code: "25", name: "Paraíba", region: "Nordeste" },
  PE: { code: "26", name: "Pernambuco", region: "Nordeste" }, AL: { code: "27", name: "Alagoas", region: "Nordeste" },
  SE: { code: "28", name: "Sergipe", region: "Nordeste" }, BA: { code: "29", name: "Bahia", region: "Nordeste" },
  MG: { code: "31", name: "Minas Gerais", region: "Sudeste" }, ES: { code: "32", name: "Espírito Santo", region: "Sudeste" },
  RJ: { code: "33", name: "Rio de Janeiro", region: "Sudeste" }, SP: { code: "35", name: "São Paulo", region: "Sudeste" },
  PR: { code: "41", name: "Paraná", region: "Sul" }, SC: { code: "42", name: "Santa Catarina", region: "Sul" },
  RS: { code: "43", name: "Rio Grande do Sul", region: "Sul" }, MS: { code: "50", name: "Mato Grosso do Sul", region: "Centro-Oeste" },
  MT: { code: "51", name: "Mato Grosso", region: "Centro-Oeste" }, GO: { code: "52", name: "Goiás", region: "Centro-Oeste" },
  DF: { code: "53", name: "Distrito Federal", region: "Centro-Oeste" },
};

// Só nestes anos a vírgula separa milhar.
const COMMA_THOUSANDS_YEARS = new Set([2001, 2002]);

/**
 * O formato muda conforme o período. Devolve texto decimal, sem passar por ponto flutuante.
 * Em 2001 e 2002, a vírgula separa milhar, e o grupo final com 1 ou 2 dígitos perdeu zeros (28,53 é 28.530).
 * Nos demais anos, a vírgula é decimal (1234,56), às vezes com ponto de milhar (226.708.856,85).
 */
export function parseValue(raw: string, year: number): string {
  if (/^-?\d+$/.test(raw)) return raw;
  if (COMMA_THOUSANDS_YEARS.has(year)) {
    if (!/^-?\d{1,3}(,\d{3})*,\d{1,3}$/.test(raw)) throw new Error(`Número fora do formato de ${year}: "${raw}"`);
    const groups = raw.split(",");
    groups[groups.length - 1] = groups.at(-1)!.padEnd(3, "0");
    return groups.join("");
  }
  if (/^-?\d+,\d+$/.test(raw)) return raw.replace(",", ".");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) return raw.replaceAll(".", "").replace(",", ".");
  throw new Error(`Número fora do formato esperado em ${year}: "${raw}"`);
}

export type Cell = { year: number; month: number; state: string; cropCode: string; cropName: string; value: string };

/** Célula vazia não entra: é "sem dado", não zero. Recebe os bytes, porque a fonte vem em Windows-1252. */
export function parseMonthlyCsv(bytes: Uint8Array): Cell[] {
  const lines = new TextDecoder("windows-1252").decode(bytes).split(/\r?\n/).filter((line) => line !== "");
  if (lines.length < 2) throw new Error("O arquivo veio sem linhas de dados.");
  const header = lines[0].split(";");
  if (header[0] !== "Ano" || header[1] !== "Mês" || header[2] !== "UF") throw new Error("O cabeçalho mudou: esperava Ano, Mês e UF.");
  const cells: Cell[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((line, index) => {
    const parts = line.split(";");
    if (parts.length !== header.length) throw new Error(`Linha ${index + 2}: esperava ${header.length} colunas, e vieram ${parts.length}.`);
    const year = Number(parts[0]);
    const month = MONTHS.indexOf(parts[1]) + 1;
    if (!Number.isInteger(year) || month === 0 || !Object.hasOwn(STATES, parts[2])) throw new Error(`Linha ${index + 2}: ano, mês ou UF inválidos.`);
    const key = `${year}|${month}|${parts[2]}`;
    if (seen.has(key)) throw new Error(`Linha ${index + 2}: repetida.`);
    seen.add(key);
    for (let column = 3; column < parts.length; column++) {
      if (parts[column] === "") continue;
      cells.push({ year, month, state: STATES[parts[2]].code, cropCode: String(column), cropName: header[column], value: parseValue(parts[column], year) });
    }
  });
  return cells;
}

// Soma exata: o valor vira um inteiro em unidades de 1e-6, sem ponto flutuante. O arquivo tem até 4 casas.
const SCALE = 6;

export function toScaled(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  if (fraction.length > SCALE) throw new Error(`Casas demais: "${value}"`);
  const scaled = BigInt(whole + fraction.padEnd(SCALE, "0"));
  return negative ? -scaled : scaled;
}

export function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(SCALE + 1, "0");
  const fraction = digits.slice(-SCALE).replace(/0+$/, "");
  return `${negative ? "-" : ""}${digits.slice(0, -SCALE)}${fraction ? `.${fraction}` : ""}`;
}

/** Soma exata por uma chave. */
export function totalsBy(cells: Cell[], keyOf: (cell: Cell) => string): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const cell of cells) {
    const key = keyOf(cell);
    totals.set(key, (totals.get(key) ?? 0n) + toScaled(cell.value));
  }
  return totals;
}

/** Grava as células na tabela production do esquema atual da conexão. */
export async function loadCells(client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, cells: Cell[]) {
  const stateOf = new Map(Object.values(STATES).map((state) => [state.code, state]));
  const BATCH = 10_000;
  for (let start = 0; start < cells.length; start += BATCH) {
    const part = cells.slice(start, start + BATCH);
    await client.query(`
      INSERT INTO production (year, month, state_code, state_name, region, crop_code, crop_name, value_brl, quantity_unit)
      SELECT y, m, s, sn, r, c, cn, v::numeric, 't'
      FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS t(y, m, s, sn, r, c, cn, v)`, [
      part.map((c) => c.year),
      part.map((c) => c.month),
      part.map((c) => c.state),
      part.map((c) => stateOf.get(c.state)!.name),
      part.map((c) => stateOf.get(c.state)!.region),
      part.map((c) => c.cropCode),
      part.map((c) => c.cropName),
      part.map((c) => c.value),
    ]);
  }
}

/** O mesmo, no SQLite: cria o arquivo, com o mês e com escala 4 no valor, porque o arquivo tem até 4 casas. */
export async function loadCellsSqlite(file: string, cells: Cell[]) {
  const { createSqliteFile, openSqlite, writeRows } = await import("../server/db/sqlite.ts");
  const { producaoAgricola } = await import("../dashboards/producao-agricola/dashboard.ts");
  const stateOf = new Map(Object.values(STATES).map((state) => [state.code, state]));
  createSqliteFile(file, producaoAgricola.sqlite({ MONTH_FILTER: "on", SQLITE_VALUE_SCALE: "4" }));
  const admin = openSqlite(file, null);
  const db = admin.handle();
  db.exec("BEGIN");
  writeRows(db, "production", cells.map((c) => ({
    year: c.year, month: c.month, state_code: c.state, state_name: stateOf.get(c.state)!.name, region: stateOf.get(c.state)!.region,
    crop_code: c.cropCode, crop_name: c.cropName, value_brl: c.value, quantity_unit: "t",
  })));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO load_log (entity, started_at, finished_at, status) VALUES ('prova do mês', ?, ?, 'ok')").run(now, now);
  db.exec("COMMIT; ANALYZE");
  await admin.end();
}

/**
 * Prepara um esquema já criado: as mesmas tabelas do modelo, com o mês, e sem arredondar o valor, porque o arquivo tem até 4 casas.
 * Quem chama passa o texto dos arquivos SQL, para este módulo não tocar em disco.
 */
export async function prepareSchema(client: { query: (sql: string) => Promise<unknown> }, schema: string, sql: { tables: string; month: string; grants: string }) {
  if (!/^[a-z0-9_]+$/.test(schema)) throw new Error("Nome de esquema inválido.");
  await client.query(`SET search_path TO ${schema}`);
  await client.query(sql.tables);
  await client.query(sql.month);
  await client.query("ALTER TABLE production ALTER COLUMN value_brl TYPE NUMERIC");
  await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${readerRole(producaoAgricola.db)}, ${loaderRole(producaoAgricola.db)}`);
  await client.query(sql.grants);
}
