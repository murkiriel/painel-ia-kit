// Administração: pessoas, dashboards e o acesso de cada um. Só o administrador chega aqui, e o servidor confere de novo em cada pedido.
// Um dashboard pode ter recorte (estado, fazenda...), com nome próprio; sem recorte, o acesso é só "com" ou "sem".
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { allOf, countOf, groupOf, onlyThese, type DashboardScope } from "../../../shared/scope.ts";
import { api } from "../api.ts";
import { go } from "../hooks.ts";

type Access = { full: boolean; codes: string[] };
type AdminUser = { id: string; login: string; name: string; isAdmin: boolean; active: boolean; mustChangePassword: boolean; access: Record<string, Access> };
type AdminDashboard = { slug: string; name: string; scope: DashboardScope | null; categoryId: string | null };
type AdminCategory = { id: string; name: string };
type Overview = { users: AdminUser[]; dashboards: AdminDashboard[]; categories: AdminCategory[] };
type Mode = "none" | "all" | "some";

const modeOf = (access: Access | undefined): Mode => (!access ? "none" : access.full ? "all" : "some");

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("pt-BR") + text.slice(1);

const summary = (user: AdminUser, dashboards: AdminDashboard[]) => {
  if (user.isAdmin) return "Todos os dashboards, inteiros";
  const parts = dashboards.flatMap((d) => {
    const access = user.access[d.slug];
    if (!access) return [];
    if (!d.scope) return [`${d.name}: com acesso`];
    return [`${d.name}: ${access.full ? lowerFirst(allOf(d.scope.label)) : countOf(d.scope.label, access.codes.length)}`];
  });
  return parts.length ? parts.join(" · ") : "Nenhum dashboard";
};

type Act = (path: string, body: Record<string, unknown>, done: string) => Promise<Record<string, unknown> | null>;

/** O que uma pessoa tem dos dashboards de uma categoria: todos, alguns ou nenhum. */
export function categoryState(user: AdminUser, slugs: string[]): "all" | "some" | "none" | "empty" {
  if (slugs.length === 0) return "empty";
  const have = slugs.filter((slug) => user.access[slug]).length;
  return have === 0 ? "none" : have === slugs.length ? "all" : "some";
}

/** Atalho por categoria na tela de uma pessoa: marcar dá acesso total a todos os dashboards dela, um acesso por dashboard. */
function CategoryShortcut({ user, overview, act }: { user: AdminUser; overview: Overview; act: Act }) {
  if (overview.categories.length === 0) return null;
  return (
    <fieldset className="access" data-shortcut="categorias">
      <legend>Atalho por categoria</legend>
      {overview.categories.map((category) => {
        const slugs = overview.dashboards.filter((d) => d.categoryId === category.id).map((d) => d.slug);
        const state = categoryState(user, slugs);
        return (
          <div key={category.id} className="shortcut" data-category={category.name}>
            <label>
              <input
                type="checkbox"
                checked={state === "all"}
                disabled={state === "empty"}
                ref={(box) => { if (box) box.indeterminate = state === "some"; }}
                onChange={() => act("/api/admin/set-category-access", { userId: user.id, categoryId: category.id, mode: state === "all" ? "none" : "all" },
                  state === "all" ? `${user.login} ficou sem os dashboards de ${category.name}.` : `${user.login} ficou com acesso total aos dashboards de ${category.name}.`)}
              />
              {category.name}
            </label>
            <small>{state === "empty" ? "Sem dashboards" : state === "all" ? "Todos os dashboards" : state === "some" ? `Alguns dashboards (${slugs.filter((slug) => user.access[slug]).length} de ${slugs.length})` : "Nenhum dashboard"}</small>
          </div>
        );
      })}
      <small>Marcar dá acesso total. Nos dashboards com recorte, ele continua em cada um, abaixo.</small>
    </fieldset>
  );
}

/** Categorias dos dashboards: criar, renomear, ordenar, apagar (só vazia) e escolher a de cada dashboard. */
function Categories({ overview, act }: { overview: Overview; act: Act }) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<Record<string, string>>({});

  return (
    <section className="block" aria-label="Categorias">
      <h3 className="block-title">Categorias de dashboards</h3>
      <form className="admin-form" onSubmit={async (event) => { event.preventDefault(); if (await act("/api/admin/create-category", { name }, `Categoria criada: ${name.trim()}.`)) setName(""); }}>
        <label>Nova categoria<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="off" /></label>
        <button type="submit">Criar categoria</button>
      </form>
      <ul className="categories">
        {overview.categories.map((category, index) => {
          const members = overview.dashboards.filter((d) => d.categoryId === category.id);
          const text = renaming[category.id] ?? category.name;
          return (
            <li key={category.id} className="category-row" data-category={category.name}>
              <input aria-label={`Nome da categoria ${category.name}`} value={text} maxLength={40} onChange={(e) => setRenaming({ ...renaming, [category.id]: e.target.value })} />
              <button type="button" disabled={text === category.name}
                onClick={async () => { if (await act("/api/admin/rename-category", { id: category.id, name: text }, `Categoria renomeada para ${text.trim()}.`)) setRenaming(({ [category.id]: _, ...rest }) => rest); }}>Renomear</button>
              <button type="button" disabled={index === 0} onClick={() => act("/api/admin/move-category", { id: category.id, direction: "up" }, `${category.name} subiu.`)}>Subir</button>
              <button type="button" disabled={index === overview.categories.length - 1} onClick={() => act("/api/admin/move-category", { id: category.id, direction: "down" }, `${category.name} desceu.`)}>Descer</button>
              <button type="button" disabled={members.length > 0} title={members.length > 0 ? "Só se apaga categoria sem dashboards." : "Apagar a categoria"}
                onClick={() => act("/api/admin/delete-category", { id: category.id }, `Categoria apagada: ${category.name}.`)}>Apagar</button>
              <span className="category-members">{members.length ? `Dashboards: ${members.map((d) => d.name).join(", ")}` : "Sem dashboards"}</span>
            </li>
          );
        })}
      </ul>
      <div className="dashboard-categories">
        {overview.dashboards.map((dashboard) => (
          <label key={dashboard.slug} data-dashboard={dashboard.slug}>
            <span>{dashboard.name}</span>
            <select
              aria-label={`Categoria de ${dashboard.name}`}
              value={dashboard.categoryId ?? ""}
              onChange={(e) => act("/api/admin/set-dashboard-category", { dashboard: dashboard.slug, categoryId: e.target.value || null }, `Categoria de ${dashboard.name} salva.`)}
            >
              <option value="">Sem categoria</option>
              {overview.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="detail-hint">Mudar a categoria de um dashboard não muda o acesso de ninguém. Um dashboard novo numa categoria precisa ser liberado para cada pessoa.</p>
    </section>
  );
}

/** Um dashboard de uma pessoa: sem acesso, com acesso total ou, se o dashboard tem recorte, só alguns itens dele. */
function AccessEditor({ user, dashboard, onSaved, onError }: { user: AdminUser; dashboard: AdminDashboard; onSaved: () => void; onError: (message: string) => void }) {
  const current = user.access[dashboard.slug];
  const { scope } = dashboard;
  const [mode, setMode] = useState<Mode>(modeOf(current));
  const [codes, setCodes] = useState<string[]>(current?.codes ?? []);
  const [busy, setBusy] = useState(false);
  const name = `acesso-${user.id}-${dashboard.slug}`;
  const choices: (readonly [Mode, string])[] = scope
    ? [["none", "Sem acesso"], ["all", allOf(scope.label)], ["some", onlyThese(scope.label)]]
    : [["none", "Sem acesso"], ["all", "Com acesso"]];

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/admin/set-access", { body: { userId: user.id, dashboard: dashboard.slug, mode, codes } });
      onSaved();
    } catch (failure) {
      onError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (code: string) => setCodes((now) => (now.includes(code) ? now.filter((c) => c !== code) : [...now, code]));

  return (
    <fieldset className="access" data-dashboard={dashboard.slug}>
      <legend>{dashboard.name}</legend>
      <div className="access-modes">
        {choices.map(([value, label]) => (
          <label key={value}>
            <input type="radio" name={name} checked={mode === value} onChange={() => setMode(value)} /> {label}
          </label>
        ))}
        <button type="button" onClick={save} disabled={busy || (mode === "some" && codes.length === 0)}>Salvar</button>
      </div>
      {scope && mode === "some" && (
        <div className="access-states" role="group" aria-label={groupOf(scope.label, dashboard.name)}>
          {scope.items.map((item) => (
            <label key={item.code}>
              <input type="checkbox" checked={codes.includes(item.code)} onChange={() => toggle(item.code)} /> {item.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function Admin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provisional, setProvisional] = useState<{ login: string; password: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(() => {
    api<Overview>("/api/admin/overview").then((data) => { setOverview(data); setFailure(null); }).catch((e) => setFailure((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const act: Act = async (path, body, done) => {
    setError(null);
    setMessage(null);
    try {
      const result = await api<Record<string, unknown>>(path, { body });
      setMessage(done);
      load();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setProvisional(null);
    const result = await act("/api/admin/create-user", { login, name }, `Pessoa criada: ${login}. Marque os dashboards dela.`);
    if (result) {
      setProvisional({ login, password: String(result.password) });
      setLogin("");
      setName("");
      setEditing(String(result.id));
    }
  };

  const reset = async (user: AdminUser) => {
    setProvisional(null);
    const result = await act("/api/admin/reset-password", { userId: user.id }, `Senha de ${user.login} redefinida. As sessões dela foram encerradas.`);
    if (result) setProvisional({ login: user.login, password: String(result.password) });
  };

  if (failure) {
    return (
      <main className="page">
        <section className="block state error" role="alert">
          <span>Não foi possível abrir a administração. {failure}</span>
          <button type="button" onClick={() => go("/")}>Voltar ao início</button>
        </section>
      </main>
    );
  }
  if (!overview) return null;

  return (
    <main className="page admin">
      <h2 className="portal-title">Administração</h2>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      {provisional && (
        <section className="block provisional" role="status" aria-label="Senha provisória">
          <p>Senha provisória de <strong>{provisional.login}</strong>:</p>
          <p><code className="provisional-password">{provisional.password}</code></p>
          <p>Anote agora e repasse a ela: esta senha não é mostrada de novo. No primeiro acesso, a pessoa escolhe a sua.</p>
          <button type="button" onClick={() => setProvisional(null)}>Já anotei</button>
        </section>
      )}

      <section className="block">
        <h3 className="block-title">Nova pessoa</h3>
        <form className="admin-form" onSubmit={create}>
          <label>Usuário<input value={login} onChange={(e) => setLogin(e.target.value)} required maxLength={128} autoComplete="off" /></label>
          <label>Nome (opcional)<input value={name} onChange={(e) => setName(e.target.value)} maxLength={128} autoComplete="off" /></label>
          <button type="submit">Criar com senha provisória</button>
        </form>
      </section>

      <Categories overview={overview} act={act} />

      <section className="block" aria-label="Pessoas">
        <h3 className="block-title">Pessoas</h3>
        <ul className="people">
          {overview.users.map((user) => (
            <li key={user.id} className="person" data-login={user.login}>
              <div className="person-head">
                <strong>{user.login}</strong>
                {user.name !== user.login && <span>{user.name}</span>}
                <span className={`status ${user.active ? "" : "status-off"}`}>
                  {user.isAdmin ? "Administrador" : !user.active ? "Desativada" : user.mustChangePassword ? "Senha provisória" : "Ativa"}
                </span>
              </div>
              <div className="person-access">{summary(user, overview.dashboards)}</div>
              {!user.isAdmin && (
                <div className="person-actions">
                  <button type="button" aria-expanded={editing === user.id} onClick={() => setEditing(editing === user.id ? null : user.id)}>Dashboards e acessos</button>
                  <button type="button" onClick={() => reset(user)}>Redefinir senha</button>
                  <button type="button" onClick={() => act("/api/admin/set-active", { userId: user.id, active: !user.active }, user.active ? `${user.login} foi desativada.` : `${user.login} foi reativada.`)}>
                    {user.active ? "Desativar" : "Reativar"}
                  </button>
                </div>
              )}
              {editing === user.id && !user.isAdmin && (
                <div className="person-editor">
                  <CategoryShortcut user={user} overview={overview} act={act} />
                  {overview.dashboards.map((dashboard) => (
                    <AccessEditor
                      key={`${user.id}-${dashboard.slug}-${JSON.stringify(user.access[dashboard.slug] ?? null)}`}
                      user={user}
                      dashboard={dashboard}
                      onSaved={() => { setError(null); setMessage(`Acesso de ${user.login} a ${dashboard.name} salvo.`); load(); }}
                      onError={setError}
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
