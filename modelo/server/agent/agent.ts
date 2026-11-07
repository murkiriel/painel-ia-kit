// Laço do agente, controlado pelo backend. Garantias ficam no código, não só na instrução.
import { type DashboardScope, noneOf, others, these } from "../../shared/scope.ts";
import { ModelUnavailable, type AgentAnswer, type AgentSetup, type AgentTool, type Message, type ModelAdapter, type ToolResult, type Turn } from "./types.ts";

const MAX_STEPS = 5;
const MAX_TOOLS_PER_STEP = 8;
export const MAX_QUESTION = 500;
const TIMEOUT_MS = 60_000;
const OFF_TOPIC = "Só respondo sobre os dados deste dashboard. Pergunte sobre os indicadores que ele mostra.";

// Regras comuns a todos os dashboards, somadas à instrução de cada um.
const COMMON_RULES = `

## Formato
- A tela mostra só três recursos de Markdown: **negrito**, listas com "- " (um item por linha) e parágrafos separados por linha em branco. Não use títulos, tabelas, links, código nem outro recurso.
- Fora do tema: recuse em uma ou duas frases, sem número nem data, dizendo o que você responde. Exemplos de número ou de data numa recusa seriam barrados.`;

// Só entra quando há troca anterior na conversa.
const MEMORY_RULES = `

## Conversa anterior
- As mensagens marcadas como "Pergunta anterior", com as respostas que vêm depois, são só contexto, para entender perguntas como "e em agosto?". Os filtros que valiam naquele momento vêm junto.
- Os números delas não valem. Nunca repita um número de uma resposta anterior: consulte as ferramentas de novo para a pergunta atual, mesmo que ache que já sabe a resposta.
- Numa pergunta de seguimento, mantenha o assunto anterior e troque só o que a pessoa pediu.`;

/**
 * O que a pessoa pode ver do recorte do dashboard, pelos nomes, para o modelo não oferecer o que ela não pode.
 * Sem recorte, ou com tudo permitido, não há o que dizer.
 */
export function permissionNote(scope: DashboardScope | undefined, allowed: string[]): string {
  if (!scope || allowed.length >= scope.items.length) return "";
  const names = allowed.length ? allowed.join(", ") : noneOf(scope.label);
  return `

## Permissão
- Esta pessoa só pode ver ${these(scope.label)}: ${names}. Nunca ofereça, sugira nem cite ${others(scope.label)}, e não diga que existem.`;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
// Número por extenso e aproximação nunca têm origem nas ferramentas, que só devolvem algarismos.
// De um a dez ficam de fora, porque "as três maiores" é uma resposta legítima.
const WORDS = /\b(?:mil|milh(?:ão|ões)|bilh(?:ão|ões)|trilh(?:ão|ões)|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent[oa]s|trezent[oa]s|quatrocent[oa]s|quinhent[oa]s|seiscent[oa]s|setecent[oa]s|oitocent[oa]s|novecent[oa]s|dobro|triplo|ter[çc]os?|vezes mais|cerca de|aproximadamente)\b/gi;

/**
 * Número sem origem na pergunta ou nos dados que o modelo recebeu. Código de item do recorte ou de lavoura,
 * data e campo não liberado não contam: os dígitos deles deixariam passar um número inventado.
 */
export function unknownNumbers(text: string, results: Pick<ToolResult, "rows" | "source" | "warnings">[], question: string): string[] {
  const data = results.map((r) => ({
    rows: r.rows.map(({ codigo: _codigo, ...row }) => row),
    period: r.source.period,
    warnings: r.warnings,
  }));
  const known = new Set(`${JSON.stringify(data)} ${question}`.match(NUMBER) ?? []);
  const numbers = (text.match(NUMBER) ?? []).filter((n) => !known.has(n));
  return [...numbers, ...(text.match(WORDS) ?? [])];
}

function finish(status: AgentAnswer["status"], text: string, results: ToolResult[], screen?: string): AgentAnswer {
  const updatedAt = results.map((r) => r.updatedAt).find((value) => value !== null) ?? null;
  return {
    status,
    text,
    sources: results.map((r) => r.source),
    updatedAt,
    truncated: results.some((r) => r.truncated),
    warnings: [...new Set(results.flatMap((r) => r.warnings))],
    ...(screen === undefined ? {} : { screen }),
  };
}

/** A conversa guardada vira mensagens de contexto, antes da pergunta atual. */
export function historyMessages(history: Turn[]): Message[] {
  return history.flatMap((turn): Message[] => [
    { role: "user", content: `Pergunta anterior (filtros da tela naquele momento: ${turn.screen || "sem filtros"}): ${turn.question}`, history: true },
    { role: "assistant", content: turn.answer.text || "(sem resposta)", toolCalls: [], history: true },
  ]);
}

// Limita a espera. A chamada ao provedor segue até ele responder, porque o adaptador é quem pode cancelá-la.
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Tempo máximo do agente excedido.")), timeoutMs);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Parâmetro fora do esquema é recusado sem executar a consulta. */
export function validateInput(tool: AgentTool<never>, input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(tool.parameters, key)) return { ok: false };
    const schema = tool.parameters[key];
    if (schema.type === "integer" && !Number.isInteger(value)) return { ok: false };
    if (schema.type === "string" && typeof value !== "string") return { ok: false };
  }
  return { ok: true, value: input as Record<string, unknown> };
}

/** Campo não liberado não chega ao provedor. */
export function visibleFields(tool: AgentTool<never>, result: ToolResult): ToolResult {
  return {
    ...result,
    updatedAt: null, // a tela mostra a data, por código
    rows: result.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => tool.allowedFields.includes(key)))),
  };
}

export async function answer<C>(
  question: string,
  ctx: C,
  model: ModelAdapter,
  { systemPrompt, tools, describeScreen, refusal }: AgentSetup<C>,
  onFailure: (error: unknown) => void = () => {},
  timeoutMs = TIMEOUT_MS,
  history: Turn[] = [],
): Promise<AgentAnswer> {
  if (question.trim() === "" || question.length > MAX_QUESTION) {
    return finish("refused", `Escreva uma pergunta de até ${MAX_QUESTION} caracteres.`, []);
  }
  // Só o que o servidor guardou chega aqui. A memória serve para entender a pergunta; a trava de números abaixo só olha as ferramentas desta pergunta.
  const messages: Message[] = [...historyMessages(history), { role: "user", content: question }];
  const system = systemPrompt + COMMON_RULES + (history.length ? MEMORY_RULES : "");
  const results: ToolResult[] = [];
  const visible: ToolResult[] = [];
  const declared = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  let retried = false;

  try {
    const screen = describeScreen ? await withTimeout(describeScreen(ctx), timeoutMs) : undefined;
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await withTimeout(model.send({ system, messages, tools: declared }), timeoutMs);
      messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });

      if (reply.toolCalls.length === 0) {
        const unknown = unknownNumbers(reply.text, visible, question);
        if (unknown.length === 0) return finish("answered", reply.text, results, screen);
        // Sem nenhuma consulta, o texto não é resposta sobre os dados: é recusa que trouxe número ou data. Continua barrado, mas com a recusa normal.
        if (retried) return finish("refused", results.length === 0 ? (refusal ?? OFF_TOPIC) : "Não consegui confirmar esses números nos dados.", results, screen);
        retried = true;
        messages.push({
          role: "user",
          content: results.length === 0
            ? `Esta resposta traz números ou datas que não vieram das ferramentas: ${unknown.join(", ")}. Se a pergunta é sobre os dados do dashboard, consulte as ferramentas antes de responder. Se não é, recuse em uma ou duas frases, sem número nem data, dizendo o que você responde. Não mencione esta correção.`
            : `Estes números não vieram das ferramentas: ${unknown.join(", ")}. Reescreva a resposta do zero, só com valores das ferramentas, sem mencionar esta correção.`,
        });
        continue;
      }

      for (const [index, call] of reply.toolCalls.entries()) {
        // Toda chamada precisa de resposta, mas nenhum modelo faz o dashboard rodar consultas sem limite.
        if (index >= MAX_TOOLS_PER_STEP) {
          messages.push({ role: "tool", callId: call.id, content: "Limite de consultas por passo." });
          continue;
        }
        const tool = tools.find((t) => t.name === call.name);
        const parsed = tool ? validateInput(tool, call.input) : { ok: false as const };
        if (!tool || !parsed.ok) {
          messages.push({ role: "tool", callId: call.id, content: "Ferramenta ou parâmetro inválido." });
          continue;
        }
        const result = await withTimeout(tool.run(parsed.value, ctx), timeoutMs);
        const allowed = visibleFields(tool, result); // campo não liberado não sai
        results.push(result);
        visible.push(allowed);
        messages.push({ role: "tool", callId: call.id, content: JSON.stringify(allowed) });
      }
    }
    return finish("refused", "Não consegui responder com segurança. Tente uma pergunta mais específica.", results, screen);
  } catch (error) {
    onFailure(error); // o detalhe fica no registro; o erro pode trazer SQL
    // Provedor fora por motivo conhecido (limite, login, falhas seguidas): a pessoa sabe o porquê e quando volta.
    if (error instanceof ModelUnavailable) return finish("failed", error.publicMessage, results);
    return finish("failed", "Não consegui consultar os dados agora. O dashboard continua disponível.", results);
  }
}
