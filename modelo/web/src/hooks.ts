import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "./api.ts";

const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};

/** A URL é a única fonte de verdade. Cada mudança entra no histórico, então o Voltar desfaz o filtro. */
export function useFilters() {
  const search = useSyncExternalStore(subscribe, () => window.location.search);

  const navigate = useCallback((query: string, options?: { replace?: boolean }) => {
    const url = query ? `?${query}` : window.location.pathname;
    if (options?.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return { search, navigate };
}

/** O endereço da tela (/, /admin, /d/<slug>). Muda com os links do portal e com o Voltar. */
export function usePath() {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** Vai para outra tela do portal, sem recarregar a página: o Voltar do navegador desfaz. */
export function go(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Telas estreitas pedem outro desenho, para o número continuar visível. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}

export type PanelState<T> =
  | { status: "loading"; data?: T }
  | { status: "error"; message: string; invalidLink: boolean; unpublished?: boolean; forbidden?: boolean; notFound?: boolean }
  | { status: "ok"; data: T };

/**
 * Cada bloco busca por conta própria, para uma falha derrubar só aquele bloco.
 * A dependência é o texto da consulta: dado novo não dispara nova busca.
 */
export function usePanel<T>(endpoint: string, query: string) {
  const [state, setState] = useState<PanelState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Mantém o dado anterior enquanto carrega, mesmo em cliques seguidos.
    setState((previous) => ({ status: "loading", data: previous.status === "error" ? undefined : previous.data }));

    api<T>(query ? `${endpoint}?${query}` : endpoint, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ok", data });
      })
      .catch((error) => {
        // Consulta cancelada por um filtro mais novo não é erro.
        if (controller.signal.aborted) return;
        // Erro 400 é link inválido: tentar de novo não resolve.
        setState({ status: "error", message: error.message, invalidLink: error instanceof ApiError && error.status === 400, unpublished: error instanceof ApiError && error.unpublished, forbidden: error instanceof ApiError && error.status === 403, notFound: error instanceof ApiError && error.status === 404 });
      });

    // Ao mudar o filtro, cancela a anterior: resposta atrasada não sobrescreve a nova.
    return () => controller.abort();
  }, [endpoint, query, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
