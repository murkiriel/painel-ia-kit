// Adaptador da API do Claude. A chave vem do ambiente e nunca vai para o navegador.
import Anthropic from "@anthropic-ai/sdk";
import type { Message, ModelAdapter } from "./types.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";

const MAX_TOKENS = 16_000;
// Cancela a chamada, para o gasto parar junto com a espera. Fica abaixo do limite do laço do agente.
const REQUEST_TIMEOUT_MS = 55_000;

/** Converte a conversa. Resultados seguidos de ferramentas vão juntos, em uma única mensagem. */
export function toClaudeMessages(messages: Message[]): Anthropic.Beta.BetaMessageParam[] {
  const converted: Anthropic.Beta.BetaMessageParam[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      converted.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      // O bloco de raciocínio precisa voltar como veio: por isso a resposta original é reenviada.
      // Resposta de uma troca anterior da conversa não tem original: vai como texto.
      converted.push({ role: "assistant", content: (message.raw as Anthropic.Beta.BetaContentBlockParam[] | undefined) ?? [{ type: "text", text: message.content }] });
    } else {
      const result: Anthropic.Beta.BetaToolResultBlockParam = { type: "tool_result", tool_use_id: message.callId, content: message.content };
      const last = converted.at(-1);
      if (last?.role === "user" && Array.isArray(last.content)) last.content.push(result);
      else converted.push({ role: "user", content: [result] });
    }
  }
  return converted;
}

export function createClaudeModel(model = DEFAULT_MODEL): ModelAdapter {
  const client = new Anthropic();
  return {
    async send({ system, messages, tools }) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: "medium" },
        // Se a pergunta for recusada por engano, a própria API tenta de novo em outro modelo.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: toClaudeMessages(messages),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: { type: "object" as const, properties: tool.parameters, additionalProperties: false },
        })),
      }, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

      if (response.stop_reason === "refusal") return { text: "Não posso responder a essa pergunta.", toolCalls: [] };
      // Resposta cortada não pode virar resposta certa.
      if (response.stop_reason === "max_tokens") throw new Error("Resposta do modelo cortada.");

      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      const toolCalls = response.content.flatMap((block) =>
        block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : [],
      );
      return { text, toolCalls, raw: response.content };
    },
  };
}
