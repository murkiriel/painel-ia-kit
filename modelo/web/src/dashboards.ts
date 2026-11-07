// As telas dos dashboards, carregadas só quando a pessoa abre o endereço de cada um (/d/<slug>).
// Para acrescentar um dashboard, liste aqui a pasta dele. O site estático de um dashboard só leva o que é dele.
import type { DashboardView } from "./dashboardView.ts";

const only = (slug: string) => __STATIC_DASHBOARD__ === "" || __STATIC_DASHBOARD__ === slug;

const VIEWS: Record<string, (() => Promise<DashboardView>) | undefined> = {
  "producao-agricola": only("producao-agricola") ? () => import("../../dashboards/producao-agricola/web/index.tsx").then((m) => m.view) : undefined,
};

export const loadView = (slug: string): Promise<DashboardView> | null => (Object.hasOwn(VIEWS, slug) ? VIEWS[slug]?.() ?? null : null);

type StaticReader = <T>(path: string, signal?: AbortSignal) => Promise<T>;

/** Só no site estático: como ler o arquivo pré-calculado de cada consulta. É de cada dashboard. */
export async function loadStaticReader(): Promise<StaticReader> {
  if (__STATIC_DASHBOARD__ === "producao-agricola") return (await import("../../dashboards/producao-agricola/web/staticReader.ts")).readStatic;
  throw new Error("Este site estático não tem leitor de dados.");
}
