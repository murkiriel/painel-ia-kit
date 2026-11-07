// Modelo simulado, por palavras-chave, para desenvolver e testar sem chave e sem custo.
// Não representa a qualidade de um modelo real: serve para provar as travas e a tela.
import type { Message, ModelAdapter } from "../../../server/agent/types.ts";

const TOPICS: [RegExp, string, string][] = [
  [/lavoura|cultura|produto/i, "por_lavoura", "As maiores lavouras por valor"],
  [/estado|\buf\b/i, "por_uf", "Os maiores estados por valor"],
  [/regi/i, "por_regiao", "As regiões por valor"],
  [/por ano|evolu/i, "por_ano", "O valor por ano"],
  [/valor|produ|quanto|total|[áa]rea|quantidade/i, "resumo", "O resumo"],
];

const WRITE = /corrij|altere|altera|apague|mude|troque|grave/i;

const LABELS: Record<string, string> = {
  valor: "Valor",
  variacao_valor: "Variação",
  valor_ano_anterior: "Ano anterior",
  quantidade: "Quantidade",
  aviso_unidade: "Unidade",
  area: "Área",
  lavouras: "Lavouras",
  comparacao: "Atenção",
};

/** Cada número com o nome. Sem isso, a resposta vira uma lista de valores soltos. */
function describeRow(row: Record<string, string | null>): string {
  const shown = Object.entries(row).filter(([key, value]) => key !== "codigo" && value !== null && value !== "—");
  if (row.nome || row.ano) return shown.map(([, value]) => value).join(": ");
  return shown.map(([key, value]) => `${LABELS[key] ?? key}: ${String(value).replace(/\.$/, "")}`).join("; ");
}

export const simulatedModel: ModelAdapter = {
  async send({ messages }) {
    const question = messages.find((m) => m.role === "user" && !m.history)?.content ?? "";
    if (WRITE.test(question)) return { text: "Só consigo ler os dados. Não altero valores.", toolCalls: [] };

    const lastTool = messages.findLast((m): m is Extract<Message, { role: "tool" }> => m.role === "tool");
    const topic = TOPICS.find(([pattern]) => pattern.test(question));
    if (!topic) {
      return { text: "Essa pergunta não é sobre estes dados. Posso responder sobre valor, área e quantidade por lavoura, UF, região e ano.", toolCalls: [] };
    }
    if (!lastTool) {
      return { text: "", toolCalls: [{ id: "1", name: topic[1], input: {} }] };
    }

    const result = JSON.parse(lastTool.content);
    if (result.rows.length === 0) return { text: "Não há dados para esta pergunta dentro do filtro atual da tela.", toolCalls: [] };
    const lines = result.rows.slice(0, 5).map(describeRow);
    return { text: `${topic[2]} (modelo simulado): ${lines.join("; ")}.`, toolCalls: [] };
  },
};
