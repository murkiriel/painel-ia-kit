// Módulo único de formatação: nenhum componente formata número ou data por conta própria.
// Só formata. Quem calcula é o backend ou a carga de dados.

const LOCALE = "pt-BR";
const CURRENCY = "BRL";

/** Sem dado. Zero real aparece como zero. */
export const EMPTY = "—";

type Value = number | string | null | undefined;

const isEmpty = (value: Value) =>
  value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(Number(value));

// O Intl aceita o texto decimal sem passar por ponto flutuante, então um NUMERIC
// do Postgres, que chega como texto, é exibido sem perder precisão.
const exact = (value: Value) => value as number;

const fixed = (digits: number) => ({ minimumFractionDigits: digits, maximumFractionDigits: digits });

// Sem "-R$ 0" quando um valor negativo pequeno arredonda para zero.
const plain = (digits: number) => ({ ...fixed(digits), signDisplay: "negative" as const });

const clean = (text: string) => text.replace(/ /g, " ");

/** Valor para o gráfico desenhar. Sem dado continua sem dado: nunca vira zero. */
export function chartValue(value: Value): number | null {
  return isEmpty(value) ? null : Number(value);
}

export function decimal(value: Value, digits = 0): string {
  if (isEmpty(value)) return EMPTY;
  return new Intl.NumberFormat(LOCALE, plain(digits)).format(exact(value));
}

/** R$ exato, para conferência e dica do mouse. Preço unitário: 2 a 4 casas. */
export function money(value: Value, digits = 0): string {
  if (isEmpty(value)) return EMPTY;
  return clean(
    new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY, ...plain(digits) }).format(exact(value)),
  );
}

/** Quantidade com a unidade junto do número: "90.280 kg". */
export function quantity(value: Value, unit: string, digits = 0): string {
  if (isEmpty(value)) return EMPTY;
  return `${decimal(value, digits)} ${unit}`;
}

/** Recebe a fração: 0,256 vira "25,6%". */
export function percent(value: Value, digits = 1): string {
  if (isEmpty(value)) return EMPTY;
  return clean(new Intl.NumberFormat(LOCALE, { style: "percent", ...plain(digits) }).format(exact(value))).replace(" ", "");
}

/** Variação com sinal. Recebe a fração: 0,125 vira "+12,5%". */
export function variation(value: Value, digits = 1): string {
  if (isEmpty(value)) return EMPTY;
  return clean(
    new Intl.NumberFormat(LOCALE, { style: "percent", signDisplay: "exceptZero", ...fixed(digits) }).format(exact(value)),
  ).replace(" ", "");
}

/** Diferença entre dois percentuais: "+1,5 p.p." */
export function points(value: Value, digits = 1): string {
  if (isEmpty(value)) return EMPTY;
  return `${new Intl.NumberFormat(LOCALE, { signDisplay: "exceptZero", ...fixed(digits) }).format(exact(value))} p.p.`;
}

// Fator, sufixo e casas decimais.
const SCALES: [number, string, number][] = [
  [1e12, "T", 2],
  [1e9, "B", 2],
  [1e6, "M", 2],
  [1e3, "K", 0],
];

/** Padrão para valores em R$: "R$ 3,40 M". Nunca para preço unitário. */
export function moneyCompact(value: Value): string {
  if (isEmpty(value)) return EMPTY;
  const number = Number(value);
  const abs = Math.abs(number);
  for (let i = 0; i < SCALES.length; i++) {
    const [factor, suffix, digits] = SCALES[i];
    if (abs < factor) continue;
    // 999.999 arredondaria para "1.000 K": sobe para a escala de cima.
    const precision = 10 ** digits;
    if (i > 0 && Math.round((abs / factor) * precision) / precision >= 1000) {
      const [upperFactor, upperSuffix, upperDigits] = SCALES[i - 1];
      return `${money(number / upperFactor, upperDigits)} ${upperSuffix}`;
    }
    return `${money(number / factor, digits)} ${suffix}`;
  }
  // 999,99 arredondaria para "R$ 1.000", fora do padrão.
  return Math.round(abs) >= 1000 ? `${money(number / 1e3, 0)} K` : money(value);
}

const asUtcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const isInvalid = (value: Date) => Number.isNaN(value.getTime());

/** Data sem hora, "aaaa-mm-dd" na origem: "31/10/2026". */
export function date(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  // Dado estranho fica como veio, para ser visto, e não derruba a tela.
  if (isInvalid(asUtcDate(iso))) return iso;
  return new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC" }).format(asUtcDate(iso));
}

/** Mês para eixo: "2026-10" vira "out/26". */
export function month(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const value = asUtcDate(`${iso.slice(0, 7)}-01`);
  if (isInvalid(value)) return iso;
  const name = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" }).format(value).replace(".", "");
  return `${name}/${iso.slice(2, 4)}`;
}

/**
 * Período de "aaaa-mm" a "aaaa-mm": "set/26", "2025", "2026, jan a set" ou "acumulado de jan/00 a set/26".
 * "months" é quantos meses têm dado. Faltando meses no meio, o intervalo esconderia a lacuna: "2017, 10 meses", como no eixo do gráfico de anos.
 */
export function periodText(first: string | null | undefined, last: string | null | undefined, months?: number): string {
  if (!first || !last) return EMPTY;
  if (first === last) return month(first);
  const year = first.slice(0, 4);
  const span = (Number(last.slice(0, 4)) - Number(year)) * 12 + Number(last.slice(5, 7)) - Number(first.slice(5, 7)) + 1;
  const missing = months !== undefined && months < span;
  if (year !== last.slice(0, 4)) return `acumulado de ${month(first)} a ${month(last)}${missing ? `, ${months} meses` : ""}`;
  if (missing) return `${year}, ${months} meses`;
  if (first.endsWith("-01") && last.endsWith("-12")) return year;
  return `${year}, ${month(first).split("/")[0]} a ${month(last).split("/")[0]}`;
}

export type Covered = { firstYear?: number | null; lastYear?: number | null; firstPeriod?: string | null; lastPeriod?: string | null; monthsCovered?: number };

/** O período que um resultado cobre, para título e tabela: "2025", "acumulado de 2016 a 2025" ou, com o mês ligado, o de periodText. Sem dado, null. */
export function coveredPeriod({ firstYear, lastYear, firstPeriod, lastPeriod, monthsCovered }: Covered): string | null {
  if (firstPeriod) return periodText(firstPeriod, lastPeriod, monthsCovered);
  if (firstYear === null || firstYear === undefined || lastYear === null || lastYear === undefined) return null;
  return firstYear === lastYear ? String(firstYear) : `acumulado de ${firstYear} a ${lastYear}`;
}

/** Instante, como a última atualização, no fuso de quem lê: "31/10/2026 20:00". */
export function dateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return EMPTY;
  if (isInvalid(new Date(iso))) return iso;
  const text = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(iso));
  return text.replace(",", "");
}
