// As telas de entrada: primeiro acesso, login e troca de senha.
import { useState, type FormEvent } from "react";
import { api, setCsrf } from "../api.ts";
import { go } from "../hooks.ts";
import { PROJECT_NAME } from "../project.ts";

export type Me = {
  mode: "local" | "login";
  user: { name: string; isAdmin: boolean } | null;
  csrf: string | null;
  mustChangePassword: boolean;
  firstLogin?: "here" | "elsewhere";
};

type Entered = { user: { name: string; isAdmin: boolean }; csrf: string; mustChangePassword: boolean };

const asMe = (result: Entered): Me => ({ mode: "login", user: result.user, csrf: result.csrf, mustChangePassword: result.mustChangePassword });

/** Sem nenhum usuário: o primeiro login é criado aqui, e esta tela deixa de existir. */
export function FirstLogin({ onDone, onTaken }: { onDone: (me: Me) => void; onTaken: (message: string) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== again) return setError("As senhas não são iguais.");
    setError(null);
    try {
      const result = await api<Entered>("/api/first-login", { body: { login, password } });
      setCsrf(result.csrf);
      onDone(asMe(result));
    } catch (failure) {
      // O login já existe, criado agora ou em outra aba: o caminho é a tela de entrar.
      const { status, message } = failure as { status?: number; message: string };
      if (status === 409 || status === 401) return onTaken(message);
      setError(message);
    }
  };

  return (
    <form className="login" onSubmit={send}>
      <h1>Primeiro acesso</h1>
      <p>Crie o login de quem administra o {PROJECT_NAME.toLowerCase()}. Ele vê todos os dashboards e cuida das outras pessoas.</p>
      <input aria-label="Usuário" placeholder="Usuário" autoComplete="username" required maxLength={128} value={login} onChange={(e) => setLogin(e.target.value)} />
      <input aria-label="Senha" placeholder="Senha, com pelo menos 8 caracteres" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      <input aria-label="Repita a senha" placeholder="Repita a senha" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      <button type="submit">Criar login e entrar</button>
      {error && <span role="alert" style={{ color: "var(--color-negative)" }}>{error}</span>}
    </form>
  );
}

export function Login({ onDone, notice }: { onDone: (me: Me) => void; notice: string | null }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await api<Entered>("/api/login", { body: { login, password } });
      setCsrf(result.csrf);
      onDone(asMe(result));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <form className="login" onSubmit={send}>
      <h1>{PROJECT_NAME}</h1>
      {notice && <p role="status" className="login-notice">{notice}</p>}
      <input aria-label="Usuário" placeholder="Usuário" autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} />
      <input aria-label="Senha" placeholder="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Entrar</button>
      {error && <span role="alert" style={{ color: "var(--color-negative)" }}>{error}</span>}
    </form>
  );
}

/** Troca de senha. Com a senha provisória, é a única tela: a pessoa só sai dela escolhendo a sua. */
export function ChangePassword({ forced, onDone }: { forced: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (next !== again) return setError("As senhas novas não são iguais.");
    setError(null);
    try {
      await api("/api/password", { body: { current, next } });
      setDone(true);
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <form className="login" onSubmit={send}>
      <h1>{forced ? "Escolha a sua senha" : "Trocar a senha"}</h1>
      {forced && <p>A senha que você recebeu é provisória. Escolha uma só sua para continuar.</p>}
      <input aria-label={forced ? "Senha provisória" : "Senha atual"} placeholder={forced ? "Senha provisória" : "Senha atual"} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      <input aria-label="Senha nova" placeholder="Senha nova, com pelo menos 8 caracteres" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
      <input aria-label="Repita a senha nova" placeholder="Repita a senha nova" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      <button type="submit" disabled={done}>Trocar a senha</button>
      {!forced && <button type="button" onClick={() => go("/")}>Voltar ao início</button>}
      {error && <span role="alert" style={{ color: "var(--color-negative)" }}>{error}</span>}
    </form>
  );
}
