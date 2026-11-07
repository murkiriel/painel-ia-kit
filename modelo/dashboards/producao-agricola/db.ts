// Onde moram os dados deste dashboard, e o que cada função do banco pode tocar.
import type { DashboardDb } from "../../server/db/open.ts";

export const DB: DashboardDb = {
  slug: "producao-agricola",
  schema: "producao_agricola",
  readTables: ["production", "source_national", "load_log"],
  loadTables: ["raw_production", "production", "source_national", "load_log"],
};
