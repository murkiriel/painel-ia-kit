// Leitura da fonte: API do IBGE, tabela 5457 (Produção Agrícola Municipal).
// Funções puras, para testar sem rede: o download fica em run.ts.

export type SidraRow = {
  D1C: string; // UF (código)
  D1N: string; // UF (nome)
  D2C: string; // variável (código)
  D2N: string; // variável (nome)
  D3N: string; // ano
  D4C: string; // lavoura (código)
  D4N: string; // lavoura (nome)
  MN: string; // unidade
  V: string; // valor ou símbolo
};

export const TOTAL_CROP = "0";
// Já é a soma de arábica e canephora, que também vêm na lista. Somar os três conta o café duas vezes.
export const COFFEE_TOTAL_CROP = "40139";

export const VARIABLES = {
  "214": { field: "quantity_t", unit: "Toneladas" },
  "215": { field: "value_brl", unit: "Mil Reais" },
  "216": { field: "area_ha", unit: "Hectares" },
} as const;

type VariableCode = keyof typeof VARIABLES;

export type Parsed = { kind: "number"; text: string } | { kind: "empty" } | { kind: "rejected" };

// Convenção do IBGE: "-" é zero; ".." não se aplica; "..." não disponível. Só "-" vira número.
export function parseValue(raw: string): Parsed {
  const value = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(value)) return { kind: "number", text: value };
  if (value === "-") return { kind: "number", text: "0" };
  if (value === ".." || value === "...") return { kind: "empty" };
  return { kind: "rejected" };
}

const REGIONS: Record<string, string> = { "1": "Norte", "2": "Nordeste", "3": "Sudeste", "4": "Sul", "5": "Centro-Oeste" };

/** A região vem do primeiro dígito do código da UF. */
export function regionOf(stateCode: string): string {
  const region = REGIONS[stateCode[0]];
  if (!region) throw new Error(`UF desconhecida: ${stateCode}`);
  return region;
}

// O asterisco aponta para uma nota de rodapé que não pudemos ler. A API diz toneladas, mas a
// unidade dessas lavouras fica marcada como a verificar até a nota ser confirmada.
export const hasUnitNote = (name: string) => /\*+$/.test(name);

export const cleanCropName = (name: string) => {
  const clean = name.replace(/\*+$/, "").trim();
  return hasUnitNote(name) ? `${clean} (unidade a verificar)` : clean;
};

// Em mil reais na fonte, em reais no banco, sem passar por ponto flutuante.
const thousandsToBrl = (text: string) => (text === "0" ? "0" : `${text}000`);

export type Production = {
  year: number;
  state_code: string;
  state_name: string;
  region: string;
  crop_code: string;
  crop_name: string;
  value_brl: string | null;
  quantity_t: string | null;
  quantity_unit: "t" | "a verificar";
  area_ha: string | null;
  // Só com o mês ligado: veja "Ligar o mês" no README. A fonte do exemplo é anual e não traz.
  month?: number;
};

export type SourceTotal = { year: number; state_code: string; value_brl: string | null; area_ha: string | null };

export type NationalTotal = {
  year: number;
  crop_code: string;
  value_brl: string | null;
  quantity_t: string | null;
  area_ha: string | null;
};

export type ParsedYear = {
  production: Production[];
  totals: SourceTotal[];
  rowsRead: number;
  rejected: string[];
};

/** Separa as linhas da fonte em produção e totais publicados. Unidade inesperada interrompe a carga. */
export function parseYear(rows: SidraRow[]): ParsedYear {
  const production = new Map<string, Production>();
  const totals = new Map<string, SourceTotal>();
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const variable = VARIABLES[row.D2C as VariableCode];
    if (!variable) throw new Error(`Variável inesperada: ${row.D2C}`);
    if (row.MN !== variable.unit) throw new Error(`Unidade inesperada em ${row.D2N}, ${row.D3N}: ${row.MN}`);
    const unique = `${row.D3N}|${row.D1C}|${row.D4C}|${row.D2C}`;
    if (seen.has(unique)) throw new Error(`Linha repetida na fonte: ${unique}`);
    seen.add(unique);

    const parsed = parseValue(row.V);
    if (parsed.kind === "rejected") {
      rejected.push(`${row.D3N}/${row.D1N}/${row.D4N}/${row.D2N}: ${row.V}`);
      continue;
    }
    const text = parsed.kind === "number" ? parsed.text : null;
    const year = Number(row.D3N);
    const key = `${year}|${row.D1C}|${row.D4C}`;

    if (row.D4C === TOTAL_CROP) {
      const total = totals.get(key) ?? { year, state_code: row.D1C, value_brl: null, area_ha: null };
      if (variable.field === "value_brl") total.value_brl = text === null ? null : thousandsToBrl(text);
      if (variable.field === "area_ha") total.area_ha = text;
      totals.set(key, total);
      continue;
    }
    if (row.D4C === COFFEE_TOTAL_CROP) continue;

    const item = production.get(key) ?? {
      year,
      state_code: row.D1C,
      state_name: row.D1N,
      region: regionOf(row.D1C),
      crop_code: row.D4C,
      crop_name: cleanCropName(row.D4N),
      value_brl: null,
      quantity_t: null,
      quantity_unit: hasUnitNote(row.D4N) ? "a verificar" : "t",
      area_ha: null,
    };
    if (variable.field === "value_brl") item.value_brl = text === null ? null : thousandsToBrl(text);
    else item[variable.field] = text;
    production.set(key, item);
  }

  // Lavoura sem plantio no estado e no ano não vira linha. Continua na camada bruta.
  const planted = [...production.values()].filter((p) => [p.value_brl, p.quantity_t, p.area_ha].some((v) => v !== null && v !== "0"));
  return { production: planted, totals: [...totals.values()], rowsRead: rows.length, rejected };
}

/** Total do Brasil por lavoura, como a fonte publica. Só alimenta a conferência. */
export function parseNational(rows: SidraRow[]): NationalTotal[] {
  const totals = new Map<string, NationalTotal>();
  for (const row of rows) {
    const variable = VARIABLES[row.D2C as VariableCode];
    if (!variable) throw new Error(`Variável inesperada: ${row.D2C}`);
    if (row.MN !== variable.unit) throw new Error(`Unidade inesperada em ${row.D2N}, ${row.D3N}: ${row.MN}`);
    const parsed = parseValue(row.V);
    if (parsed.kind === "rejected") throw new Error(`Valor não previsto no total do Brasil: ${row.V}`);
    const text = parsed.kind === "number" ? parsed.text : null;
    const year = Number(row.D3N);
    const key = `${year}|${row.D4C}`;
    const item = totals.get(key) ?? { year, crop_code: row.D4C, value_brl: null, quantity_t: null, area_ha: null };
    if (variable.field === "value_brl") item.value_brl = text === null ? null : thousandsToBrl(text);
    else item[variable.field] = text;
    totals.set(key, item);
  }
  return [...totals.values()];
}

/**
 * Compara o que vai ser gravado com o total do Brasil, antes de apagar qualquer coisa.
 * O valor aceita o arredondamento das 27 UFs. Área e quantidade são exatas.
 */
export function reconcileNational(production: Production[], national: NationalTotal[], toleranceBrl = 27_000): string[] {
  const parts = new Map<string, bigint>();
  const add = (key: string, value: string | null) => parts.set(key, (parts.get(key) ?? 0n) + BigInt((value ?? "0").split(".")[0]));
  const crops = new Set<string>();
  for (const p of production) {
    crops.add(`${p.year}|${p.crop_code}`);
    add(`quantidade|${p.year}|${p.crop_code}`, p.quantity_t);
    add(`valor|${p.year}`, p.value_brl);
    add(`area|${p.year}`, p.area_ha);
  }
  const problems: string[] = [];
  const whole = (value: string | null) => BigInt((value ?? "0").split(".")[0]);
  for (const n of national) {
    if (n.crop_code === COFFEE_TOTAL_CROP) continue;
    if (n.crop_code === TOTAL_CROP) {
      const valueDifference = (parts.get(`valor|${n.year}`) ?? 0n) - whole(n.value_brl);
      if ((valueDifference < 0n ? -valueDifference : valueDifference) > BigInt(toleranceBrl)) problems.push(`${n.year}: valor difere em R$ ${valueDifference}`);
      if ((parts.get(`area|${n.year}`) ?? 0n) !== whole(n.area_ha)) problems.push(`${n.year}: área difere`);
      continue;
    }
    crops.delete(`${n.year}|${n.crop_code}`);
    if ((parts.get(`quantidade|${n.year}|${n.crop_code}`) ?? 0n) !== whole(n.quantity_t)) problems.push(`${n.year}, lavoura ${n.crop_code}: quantidade difere`);
  }
  for (const crop of crops) problems.push(`${crop}: lavoura fora do total do Brasil`);
  return problems;
}

/** A soma só fecha se a fonte não mudou de forma. Devolve os estados e anos com diferença acima do arredondamento. */
export function reconcile(parsed: ParsedYear, toleranceBrl = 1000): string[] {
  const sums = new Map<string, bigint>();
  for (const p of parsed.production) {
    const key = `${p.year}|${p.state_code}`;
    sums.set(key, (sums.get(key) ?? 0n) + BigInt(p.value_brl ?? "0"));
  }
  const problems: string[] = [];
  for (const total of parsed.totals) {
    const key = `${total.year}|${total.state_code}`;
    const difference = (sums.get(key) ?? 0n) - BigInt(total.value_brl ?? "0");
    const absolute = difference < 0n ? -difference : difference;
    if (absolute > BigInt(toleranceBrl)) problems.push(`${key}: diferença de R$ ${difference}`);
  }
  return problems;
}
