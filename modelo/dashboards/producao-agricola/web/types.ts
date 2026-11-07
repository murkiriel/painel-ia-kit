import type { Covered } from "../../../shared/format.ts";

export type Meta = { updatedAt: string | null; warnings: string[] };

export type Option = { key: string; label: string };
export type FilterOptions = Meta & {
  ano: Option[];
  regiao: Option[];
  uf: Option[];
  lavoura: Option[];
  // Só com o mês ligado.
  mes?: Option[];
  monthsByYear?: Record<string, number[]>;
  labels: { uf: Record<string, string>; lavoura: Record<string, string>; regiao: Record<string, string> };
  scopeLabel: string;
  firstYear: number | null;
  latestYear: number | null;
  hasAccess: boolean;
};

export type Summary = Meta & {
  value: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  area: string | null;
  crops: number;
  firstYear: number | null;
  lastYear: number | null;
  previousValue: string | null;
  valueVariation: string | null;
  addedCrops: number;
  addedValue: string | null;
  removedCrops: number;
  listChanged: boolean;
  // Só com o mês ligado.
  firstPeriod?: string | null;
  lastPeriod?: string | null;
  monthsCurrent?: number;
  monthsCovered?: number;
  monthsPrevious?: number;
};

export type Row = { key: string | null; label: string; value: string | null; share?: string | null };
export type Rows = Meta & { rows: Row[]; total?: string | null };

export type ByYear = Meta & {
  categories: string[];
  series: { key: string; label: string; values: (string | null)[] }[];
  totals: (string | null)[];
  // Só com o mês ligado: anos sem os 12 meses no recorte.
  partial?: Record<string, { months: number; first: number; last: number }>;
};

export type ByMonth = Meta & { year: number | null; rows: Row[] };

export type DetailRow = {
  year?: number;
  month?: number;
  state_name?: string;
  region?: string;
  crop_name?: string;
  key?: string;
  label?: string;
  value: string | null;
  quantity: string | null;
  quantity_unit?: string | null;
  area: string | null;
};

export type Detail = Meta & {
  rows: DetailRow[];
  count: number;
  pageSize: number;
  totals: Covered & { value: string | null; quantity: string | null; quantityUnit: string | null; area: string | null; lines: number };
};

export type CheckRow = {
  indicator: string;
  kind: "money" | "area" | "count";
  year: number;
  source: string | null;
  dashboard: string | null;
  difference: string | null;
  tolerance: string;
  status: "OK" | "DIVERGE";
};
