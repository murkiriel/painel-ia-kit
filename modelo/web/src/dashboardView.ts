// O que o portal precisa de cada dashboard na tela. Cada pasta de dashboard exporta um objeto deste tipo em web/index.tsx.
import type { ReactNode } from "react";

/** O que a API do dashboard diz de si em "info": se pode abrir a conferência, se tem filtro por mês, e assim por diante. */
export type DashboardInfo = { canCheck: boolean; hasMonth?: boolean; /** Nome da categoria do dashboard no portal, para o selo. */ category?: string | null };

export type DashboardView = {
  /** O título do cabeçalho. */
  title: string;
  /** A tela principal. onScope recebe o texto dos filtros atuais, para a janela do agente. */
  Screen: (props: { info: DashboardInfo; onScope: (scope: string) => void }) => ReactNode;
  /** A conferência com a fonte, se o dashboard tiver. */
  Check?: () => ReactNode;
  /** Textos da janela do agente. */
  agent: { help: string; placeholder: string };
};
