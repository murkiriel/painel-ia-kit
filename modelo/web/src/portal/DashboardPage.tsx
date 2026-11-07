// A página de um dashboard: cabeçalho do portal, a tela dele e o agente. O endereço é /d/<slug>.
import { useEffect, useState } from "react";
import { panelQuery, setFilter } from "../../../shared/filters.ts";
import { setDashboard } from "../api.ts";
import { AgentPanel } from "../components/AgentPanel.tsx";
import { LaserToggle } from "../components/LaserToggle.tsx";
import { loadView } from "../dashboards.ts";
import type { DashboardInfo, DashboardView } from "../dashboardView.ts";
import { go, useFilters, usePanel } from "../hooks.ts";
import { PROJECT_NAME } from "../project.ts";

/** Dashboard que não existe, ou que a pessoa não pode ver: a mesma tela nos dois casos. */
export function NotFound() {
  return (
    <main className="page">
      <section className="block state" role="alert">
        <span>Esta página não foi encontrada, ou você não tem acesso a ela.</span>
        <button type="button" onClick={() => go("/")}>Voltar ao início</button>
      </section>
    </main>
  );
}

type Props = {
  slug: string;
  user: { name: string } | null;
  onLogout: (() => void) | null;
};

export function DashboardPage({ slug, user, onLogout }: Props) {
  // Antes de qualquer bloco buscar dados: o filho começa a buscar no efeito dele, que roda antes do efeito deste.
  setDashboard(slug);
  const { search, navigate } = useFilters();
  const [view, setView] = useState<DashboardView | null | undefined>(undefined);
  const [scope, setScope] = useState("");
  const info = usePanel<DashboardInfo>("info", "");

  useEffect(() => {
    setView(undefined);
    const loading = loadView(slug);
    if (loading === null) return setView(null);
    let current = true;
    loading.then((loaded) => current && setView(loaded)).catch(() => current && setView(null));
    return () => {
      current = false;
    };
  }, [slug]);

  if (view === null || (info.state.status === "error" && info.state.notFound)) return <NotFound />;
  if (info.state.status === "error") {
    return (
      <main className="page">
        <section className="block state error" role="alert">
          <span>Não foi possível abrir o dashboard. {info.state.message}</span>
          <button type="button" onClick={info.retry}>Tentar de novo</button>
          <button type="button" onClick={() => go("/")}>Voltar ao início</button>
        </section>
      </main>
    );
  }
  if (view === undefined || info.state.status !== "ok") return null;
  const Screen = view.Screen;
  const Check = view.Check;

  const showCheck = new URLSearchParams(search).get("tela") === "conferencia";
  const canCheck = !__STATIC_SITE__ && info.state.data.canCheck && Check !== undefined;

  return (
    <>
      <header className="header">
        {!__STATIC_SITE__ && <a href="/" onClick={(event) => { event.preventDefault(); go("/"); }}>← {PROJECT_NAME}</a>}
        <h1>{view.title}</h1>
        {info.state.data.category && <span className="category-badge" title="Categoria no portal">{info.state.data.category}</span>}
        <span className="spacer" />
        {canCheck && (
          <button type="button" onClick={() => navigate(setFilter(window.location.search, "tela", showCheck ? null : "conferencia"))}>
            {showCheck ? "Voltar ao dashboard" : "Conferência"}
          </button>
        )}
        {window.location.hash !== "#miniatura" && <LaserToggle />}
        {user && <span>{user.name}</span>}
        {onLogout && <button type="button" onClick={onLogout}>Sair</button>}
      </header>
      {showCheck && canCheck && Check ? <Check key={slug} /> : <Screen key={slug} info={info.state.data} onScope={setScope} />}
      {/* Fora das telas, para a conversa continuar ao abrir a Conferência. O site estático não tem agente, e a foto do cartão (#miniatura) também não mostra o botão. */}
      {!__STATIC_SITE__ && window.location.hash !== "#miniatura" && <AgentPanel key={`${slug}-${user?.name ?? "local"}`} query={panelQuery(search, null)} scope={scope} help={view.agent.help} placeholder={view.agent.placeholder} />}
    </>
  );
}
