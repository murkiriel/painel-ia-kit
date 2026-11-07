// O laço do agente e os adaptadores de modelo são comuns a todos os dashboards. O que muda de um dashboard para outro
// (instrução, ferramentas e o contexto delas) fica na pasta de cada um.

export type ToolSource = { indicator: string; period: string; filters: Record<string, string> };

export type ToolResult = {
  rows: Record<string, string | null>[];
  truncated: boolean;
  updatedAt: string | null;
  warnings: string[];
  source: ToolSource;
};

export type ParamSchema = { type: "integer" | "string"; description: string };

export type AgentTool<C = unknown> = {
  name: string;
  description: string;
  parameters: Record<string, ParamSchema>;
  allowedFields: string[]; // só estes campos vão ao provedor
  run: (input: Record<string, unknown>, ctx: C) => Promise<ToolResult>;
};

export type ToolCall = { id: string; name: string; input: unknown };

// history: mensagem de uma troca anterior da conversa, só contexto. Os adaptadores a mandam como as outras.
export type Message =
  | { role: "user"; content: string; history?: true }
  | { role: "assistant"; content: string; toolCalls: ToolCall[]; raw?: unknown; history?: true }
  | { role: "tool"; callId: string; content: string };

/**
 * O provedor está fora por um motivo que a pessoa pode saber: limite da assinatura, falta de login ou falhas seguidas.
 * `message` vai para o registro; `publicMessage`, para a tela, e nunca traz detalhe técnico nem segredo.
 */
export class ModelUnavailable extends Error {
  readonly publicMessage: string;
  constructor(message: string, publicMessage: string) {
    super(message);
    this.publicMessage = publicMessage;
  }
}

// raw: a resposta como o provedor mandou, para o adaptador reenviar sem alterar.
export type ModelReply = { text: string; toolCalls: ToolCall[]; raw?: unknown };

/** A única parte que conhece o provedor. O modelo vem de configuração. */
export type ModelAdapter = {
  send: (request: {
    system: string;
    messages: Message[];
    tools: Pick<AgentTool, "name" | "description" | "parameters">[];
  }) => Promise<ModelReply>;
};

export type AgentAnswer = {
  status: "answered" | "refused" | "failed";
  text: string;
  sources: ToolSource[];
  updatedAt: string | null;
  truncated: boolean;
  warnings: string[];
  /** O recorte de filtros da tela quando a pergunta foi feita, em texto. Fica na memória da conversa e não vai ao navegador. */
  screen?: string;
};

/** Uma troca da conversa: a pergunta, a resposta e o recorte de filtros daquele momento. */
export type Turn = { question: string; answer: Omit<AgentAnswer, "screen">; screen: string };

/** Instrução e ferramentas de um dashboard. */
export type AgentSetup<C> = {
  systemPrompt: string;
  tools: AgentTool<C>[];
  /** O recorte de filtros da tela em texto, como "Cargo: Analista; Mês: ago/26", ou "sem filtros". */
  describeScreen?: (ctx: C) => Promise<string>;
  /** O que dizer quando a pergunta não é sobre os dados do dashboard e o modelo não a recusou sem número. */
  refusal?: string;
};
