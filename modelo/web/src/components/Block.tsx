import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFilters, type PanelState } from "../hooks.ts";
import { failureAction } from "../panelRules.ts";

type Props<T> = {
  title: string;
  help: string;
  state: PanelState<T>;
  retry: () => void;
  isEmpty?: (data: T) => boolean;
  onClear?: () => void;
  minHeight?: number;
  children: (data: T) => ReactNode;
};

const HELP_WIDTH = 300;
const HELP_MARGIN = 8;

/**
 * O "i" com a explicação (o ícone de explicação é sempre "i", nunca "?"). Fica sempre dentro da tela, e fecha ao clicar fora, ao rolar ou com Esc,
 * para não ficar cobrindo o conteúdo.
 */
export function Help({ title, text }: { title: string; text: string }) {
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const area = useRef<HTMLSpanElement>(null);
  const open = position !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (!area.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (button: HTMLElement) => {
    if (open) return setPosition(null);
    const box = button.getBoundingClientRect();
    const page = document.documentElement.clientWidth;
    const width = Math.min(HELP_WIDTH, page - HELP_MARGIN * 2);
    setPosition({ left: Math.max(HELP_MARGIN, Math.min(box.left, page - width - HELP_MARGIN)), top: box.bottom + 4, width });
  };

  return (
    <span ref={area} className="help-area">
      <button className="help-button" type="button" aria-expanded={open} aria-label={`O que é: ${title}`} onClick={(event) => toggle(event.currentTarget)}>
        i
      </button>
      {position && <span className="help" role="note" style={position}>{text}</span>}
    </span>
  );
}

/** Cada bloco trata os próprios estados: carregando, falha, sem dados e atualizando. */
export function Block<T>({ title, help, state, retry, isEmpty, onClear, minHeight = 160, children }: Props<T>) {
  const { navigate } = useFilters();
  const data = state.status === "error" ? undefined : state.data;

  return (
    <section className="block">
      <h2 className="block-title">
        {title}
        <Help title={title} text={help} />
      </h2>
      {state.status === "loading" && data !== undefined && <span className="updating">Atualizando...</span>}
      {state.status === "error" ? (
        __STATIC_SITE__ && state.unpublished ? (
          <div className="state error" style={{ minHeight }}>
            <span>Esta combinação não foi publicada neste site. {state.message}</span>
            <button type="button" onClick={() => navigate("")}>Voltar ao início</button>
          </div>
        ) : state.invalidLink ? (
          <div className="state error" style={{ minHeight }}>
            <span>Este link tem um filtro inválido. {state.message}</span>
            <button type="button" onClick={() => navigate("")}>Voltar ao início</button>
          </div>
        ) : failureAction(state) === "home" ? (
          <div className="state error" style={{ minHeight }}>
            <span>Seu usuário não tem permissão para ver este bloco.</span>
            <button type="button" onClick={() => navigate("")}>Voltar ao início</button>
          </div>
        ) : (
          <div className="state error" style={{ minHeight }}>
            <span>Não foi possível carregar este bloco. {state.message}</span>
            <button type="button" onClick={retry}>Tentar de novo</button>
          </div>
        )
      ) : data === undefined ? (
        <div className="state" style={{ minHeight }}>Carregando...</div>
      ) : isEmpty?.(data) ? (
        <div className="state" style={{ minHeight }}>
          <span>Sem dados para os filtros atuais.</span>
          {onClear && <button type="button" onClick={onClear}>Limpar filtros</button>}
        </div>
      ) : (
        children(data)
      )}
    </section>
  );
}
