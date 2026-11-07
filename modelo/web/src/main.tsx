import { Component, StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { api, setCsrf } from "./api.ts";
import { go, usePath } from "./hooks.ts";
import { LaserToggle } from "./components/LaserToggle.tsx";
import { initLaser } from "./laser.ts";
import { PROJECT_NAME } from "./project.ts";
import { Admin } from "./portal/Admin.tsx";
import { DashboardPage, NotFound } from "./portal/DashboardPage.tsx";
import { ChangePassword, FirstLogin, Login, type Me } from "./portal/Entry.tsx";
import { Portal } from "./portal/Portal.tsx";
import "./theme.css";

/** Um erro em um componente nunca vira tela branca. */
class ErrorBarrier extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <section className="block state error" role="alert">
          <span>Algo deu errado ao mostrar a tela.</span>
          <button type="button" onClick={() => window.location.assign("/")}>Voltar ao início</button>
        </section>
      </main>
    );
  }
}

/** O cabeçalho do portal. Dentro de um dashboard, quem o desenha é a página dele. */
function PortalHeader({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const path = usePath();
  return (
    <header className="header">
      <h1><a href="/" onClick={(event) => { event.preventDefault(); go("/"); }}>{PROJECT_NAME}</a></h1>
      <span className="spacer" />
      {me.user?.isAdmin && path !== "/admin" && <a href="/admin" onClick={(event) => { event.preventDefault(); go("/admin"); }}>Administração</a>}
      {me.user && <LaserToggle />}
      {me.user && path !== "/senha" && <a href="/senha" onClick={(event) => { event.preventDefault(); go("/senha"); }}>Trocar a senha</a>}
      {me.user && <span>{me.user.name}</span>}
      {me.mode === "login" && me.user && <button type="button" onClick={onLogout}>Sair</button>}
    </header>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const path = usePath();

  const loadMe = useCallback(() => {
    api<Me>("/api/me")
      .then((data) => {
        setCsrf(data.csrf);
        setMe(data);
        setFailure(null);
      })
      .catch((error) => setFailure(error.message));
  }, []);

  useEffect(() => {
    loadMe();
    const expired = () => {
      setNotice("Sua sessão terminou. Entre de novo para continuar.");
      loadMe();
    };
    // A senha provisória vale só para trocá-la: qualquer outra chamada volta para a tela de troca.
    window.addEventListener("session-expired", expired);
    window.addEventListener("password-required", loadMe);
    return () => {
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("password-required", loadMe);
    };
  }, [loadMe]);

  if (failure) return <main className="page"><div className="state error">Não foi possível abrir o {PROJECT_NAME.toLowerCase()}. {failure}</div></main>;
  if (!me) return null;
  if (me.firstLogin === "here") return <FirstLogin onDone={setMe} onTaken={(message) => { setNotice(message); loadMe(); }} />;
  if (me.firstLogin === "elsewhere") {
    return (
      <main className="page">
        <section className="block state" role="status">
          <h2 className="block-title">Login ainda não configurado</h2>
          <p>O primeiro login é criado no próprio computador do {PROJECT_NAME.toLowerCase()}, por quem o administra.</p>
        </section>
      </main>
    );
  }
  if (me.mode === "login" && !me.user) return <Login onDone={(data) => { setNotice(null); setMe(data); }} notice={notice} />;
  // Senha provisória: nada além de escolher a própria.
  if (me.mustChangePassword) return <ChangePassword forced onDone={loadMe} />;

  const logout = async () => {
    await api("/api/logout", { body: {} });
    setCsrf(null);
    setNotice(null);
    loadMe();
  };

  const dashboard = /^\/d\/([^/]+)\/?$/.exec(path);
  if (dashboard) return <DashboardPage slug={decodeURIComponent(dashboard[1])} user={me.user} onLogout={me.mode === "login" ? logout : null} />;

  return (
    <>
      <PortalHeader me={me} onLogout={logout} />
      {path === "/" && <Portal />}
      {path === "/admin" && (me.user?.isAdmin ? <Admin /> : <NotFound />)}
      {path === "/senha" && (me.mode === "login" && me.user ? <ChangePassword forced={false} onDone={() => go("/")} /> : <NotFound />)}
      {path !== "/" && path !== "/admin" && path !== "/senha" && <NotFound />}
    </>
  );
}

/** O site estático de um dashboard: sem portal, sem login. */
function StaticApp() {
  return <DashboardPage slug={__STATIC_DASHBOARD__} user={null} onLogout={null} />;
}

initLaser();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBarrier>{__STATIC_SITE__ ? <StaticApp /> : <App />}</ErrorBarrier>
  </StrictMode>,
);
