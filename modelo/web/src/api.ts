// Chamadas ao backend. A falha nunca vira lista vazia: quem chama recebe o erro.
// No site estático, a mesma chamada lê o arquivo pré-calculado daquela consulta (o leitor é de cada dashboard): é a única diferença na busca dos dados.
import { loadStaticReader } from "./dashboards.ts";

let csrf: string | null = null;
// O dashboard aberto. Caminho sem barra no começo é dele ("summary"); com barra é do portal ("/api/me").
let dashboardBase = "";

/** Quem mostra um dashboard diz qual é, antes de qualquer bloco buscar dados. */
export const setDashboard = (slug: string | null) => {
  dashboardBase = slug === null ? "" : `/api/d/${slug}/`;
};

export const setCsrf = (token: string | null) => {
  csrf = token;
};

export class ApiError extends Error {
  status: number;
  /** Só no site estático: a combinação não foi publicada, e tentar de novo não resolve. */
  unpublished: boolean;
  constructor(status: number, message: string, unpublished = false) {
    super(message);
    this.status = status;
    this.unpublished = unpublished;
  }
}

export async function api<T>(path: string, init?: { body?: unknown; signal?: AbortSignal; method?: "DELETE" }): Promise<T> {
  if (__STATIC_SITE__) return (await loadStaticReader())<T>(path, init?.signal);
  const address = path.startsWith("/") ? path : dashboardBase + path;
  let response: Response;
  try {
    response = await fetch(address, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      signal: init?.signal,
      credentials: "same-origin",
      headers: init?.method ? (csrf ? { "X-CSRF-Token": csrf } : undefined) : init?.body === undefined ? undefined : { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    // O navegador descreve a falha em inglês. A tela fala português.
    throw new ApiError(0, "Sem conexão com o servidor.");
  }
  // Só o erro pode vir sem JSON. Resposta 200 ilegível é falha, nunca um objeto vazio.
  const data = await response.json().catch((error) => {
    if (init?.signal?.aborted) throw error;
    if (response.ok) throw new ApiError(response.status, "O servidor devolveu uma resposta inválida.");
    return {};
  });
  if (!response.ok) {
    // A sessão acabou: o App volta para a tela de login.
    if (response.status === 401 && path !== "/api/login" && path !== "/api/first-login") window.dispatchEvent(new Event("session-expired"));
    // Senha provisória: a tela de troca de senha toma o lugar de tudo.
    if (response.status === 403 && data.error?.startsWith("Troque a senha")) window.dispatchEvent(new Event("password-required"));
    throw new ApiError(response.status, data.error ?? `Falha ${response.status}.`);
  }
  return data as T;
}
