import { decimal, EMPTY, quantity } from "../../../shared/format.ts";

/** Espaço que não quebra: o número e a unidade nunca ficam em linhas diferentes. */
export const together = (text: string) => text.replace(/ /g, "\u00a0");

/** Quantidade com a unidade que a fonte prova. Sem confirmação, o número não afirma "toneladas". */
export function quantityText(value: string | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  return unit === "t" ? together(quantity(value, "t")) : `${decimal(value)} (unidade a verificar)`;
}
