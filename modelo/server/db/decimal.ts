// Conta decimal exata para o SQLite, que não tem NUMERIC. Tudo em BigInt, sem ponto flutuante.
// Um valor é um inteiro mais a escala da coluna: 1234,50 em NUMERIC(20,2) é 123450n com escala 2.

const INT64_MAX = 9_223_372_036_854_775_807n;
const POWER = (digits: number) => 10n ** BigInt(digits);
const absolute = (value: bigint) => (value < 0n ? -value : value);

/** Texto decimal para inteiro. Casa que não cabe na escala, ou valor além do inteiro de 64 bits, recusa a linha: nunca arredonda. */
export function toScaled(text: unknown, scale: number): bigint | null {
  if (text === null || text === undefined) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text));
  if (!match) throw new Error(`Número inválido: "${text}".`);
  const [, sign, whole, fraction = ""] = match;
  if (/[1-9]/.test(fraction.slice(scale))) throw new Error(`"${text}" tem mais de ${scale} casas: mude a escala da coluna, nunca arredonde.`);
  const digits = BigInt(whole + fraction.slice(0, scale).padEnd(scale, "0"));
  if (digits > INT64_MAX) throw new Error(`"${text}" não cabe no inteiro do SQLite.`);
  return sign ? -digits : digits;
}

/** O mesmo texto que o Postgres devolve para um NUMERIC: sempre com as casas da escala. */
export function scaledText(value: bigint, scale: number): string {
  const digits = absolute(value).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : `.${digits.slice(-scale)}`;
  return `${value < 0n ? "-" : ""}${whole}${fraction}`;
}

// O Postgres guarda NUMERIC em grupos de 4 dígitos, alinhados na vírgula.
const GROUP = 4;
const MIN_SIGNIFICANT = 16;
const MAX_SCALE = 1000;

/** Posição e valor do primeiro grupo de 4 dígitos diferente de zero. */
function firstGroup(value: bigint, scale: number): { weight: number; first: number } {
  if (value === 0n) return { weight: 0, first: 0 };
  const padding = (GROUP - (scale % GROUP)) % GROUP;
  const digits = (absolute(value) * POWER(padding)).toString();
  const groups = Math.ceil(digits.length / GROUP);
  return { weight: groups - 1 - (scale + padding) / GROUP, first: Number(digits.slice(0, digits.length - (groups - 1) * GROUP)) };
}

/**
 * Divide como o numeric_div do Postgres: a mesma escala do resultado (select_div_scale) e o mesmo
 * arredondamento, com a metade para longe do zero. Por isso o texto sai igual, casa a casa.
 * Os dois valores têm a mesma escala de entrada. Devolve o resultado e a escala dele.
 */
export function divide(a: bigint, b: bigint, scale: number): { quotient: bigint; scale: number } {
  const dividend = firstGroup(a, scale);
  const divisor = firstGroup(b, scale);
  const quotientWeight = dividend.weight - divisor.weight - (dividend.first <= divisor.first ? 1 : 0);
  const result = Math.min(Math.max(MIN_SIGNIFICANT - quotientWeight * GROUP, scale, 0), MAX_SCALE);
  const numerator = absolute(a) * POWER(result);
  const denominator = absolute(b);
  const rounded = (2n * numerator + denominator) / (2n * denominator);
  return { quotient: a < 0n !== b < 0n ? -rounded : rounded, scale: result };
}

const KEY_DIGITS = 60;

/** Chave de texto que ordena como o número, para qualquer soma: o SQLite compara texto byte a byte. */
export function sortKey(value: bigint): string {
  if (absolute(value) >= POWER(KEY_DIGITS)) throw new Error("Valor grande demais para ordenar.");
  return value < 0n ? `0${(POWER(KEY_DIGITS) + value).toString().padStart(KEY_DIGITS, "0")}` : `1${value.toString().padStart(KEY_DIGITS, "0")}`;
}

const collator = new Intl.Collator("pt-BR");

/** Ordem de dicionário do português, a mesma de um Postgres com ICU. No empate de comparação, a ordem dos bytes decide, como no Postgres. */
export const inPortuguese = (names: string[]) => [...names].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
