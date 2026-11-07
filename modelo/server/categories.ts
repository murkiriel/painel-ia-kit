// Categorias de dashboards: leitura para o portal. Quem grava é a administração (server/admin.ts).
// Uma categoria só aparece para quem vê ao menos um dashboard dela: o nome de uma categoria sem dashboard visível
// revelaria que o dashboard existe, então nada que não é visível sai daqui.
import type { Db } from "./db/types.ts";

export type Category = { id: string; name: string };
/** Nome da seção dos dashboards sem categoria. Reservado: nenhuma categoria pode ter este nome. */
export const UNCATEGORIZED = "Sem categoria";

export type Placement = {
  /** Categorias na ordem definida, só com o que cada uma tem de dashboards visíveis. */
  categories: (Category & { slugs: string[] })[];
  /** Dashboards visíveis sem categoria. */
  uncategorized: string[];
};

export function createCategories(pool: Db | null) {
  /** Todas as categorias, na ordem, e a categoria de cada dashboard. Sem login, não há categorias. */
  async function load(): Promise<{ categories: Category[]; assigned: Record<string, string> }> {
    if (!pool) return { categories: [], assigned: {} };
    const [categories, assigned] = await Promise.all([
      pool.query("SELECT id, name FROM category ORDER BY position, id"),
      pool.query("SELECT dashboard, category_id FROM dashboard_category"),
    ]);
    return {
      categories: categories.rows.map((r) => ({ id: String(r.id), name: String(r.name) })),
      assigned: Object.fromEntries(assigned.rows.map((r) => [String(r.dashboard), String(r.category_id)])),
    };
  }

  return {
    load,
    /**
     * Onde cada dashboard visível fica. Categoria sem nenhum dashboard visível não entra, e os dashboards de uma categoria
     * que não existe mais caem em "sem categoria". A ordem dos dashboards dentro de cada seção é a de "visible".
     */
    async place(visible: string[]): Promise<Placement> {
      const { categories, assigned } = await load();
      const known = new Set(categories.map((c) => c.id));
      const sections = categories.map((c) => ({ ...c, slugs: visible.filter((slug) => assigned[slug] === c.id) })).filter((c) => c.slugs.length > 0);
      return { categories: sections, uncategorized: visible.filter((slug) => !known.has(assigned[slug] ?? "")) };
    },
    /** O nome da categoria de um dashboard, para o selo dentro dele. */
    async nameOf(slug: string): Promise<string | null> {
      const { categories, assigned } = await load();
      return categories.find((c) => c.id === assigned[slug])?.name ?? null;
    },
  };
}

export type Categories = ReturnType<typeof createCategories>;
