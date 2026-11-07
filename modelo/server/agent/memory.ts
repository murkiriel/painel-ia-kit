// Memória da conversa do agente: só na memória do servidor, nunca no banco, em arquivo ou no registro.
// Uma conversa é de uma pessoa em um dashboard. Os tetos abaixo existem porque o portal roda numa VPS com pouca memória.
import type { Turn } from "./types.ts";

export type MemoryConfig = {
  /** Quantas trocas (pergunta e resposta) a conversa guarda e entrega ao modelo. */
  turns: number;
  /** Minutos sem uso até a conversa ser esquecida. */
  idleMinutes: number;
  /** Teto de conversas guardadas ao mesmo tempo. Passou, sai a usada há mais tempo. */
  maxConversations: number;
  /** Teto de caracteres de uma conversa (perguntas e respostas). Passou, saem as trocas mais antigas. */
  maxChars: number;
};

export const DEFAULT_MEMORY: MemoryConfig = { turns: 5, idleMinutes: 120, maxConversations: 200, maxChars: 20_000 };

const LIMITS = {
  AGENT_MEMORY_TURNS: { key: "turns", min: 1, max: 20 },
  AGENT_MEMORY_IDLE_MINUTES: { key: "idleMinutes", min: 1, max: 1440 },
  AGENT_MEMORY_MAX_CONVERSATIONS: { key: "maxConversations", min: 1, max: 5000 },
  AGENT_MEMORY_MAX_CHARS: { key: "maxChars", min: 1000, max: 200_000 },
} as const;

/** Lê as variáveis do .env. Vazia é o padrão; fora da faixa ou não inteira impede o servidor de subir. */
export function readMemoryConfig(env: NodeJS.ProcessEnv): MemoryConfig {
  const config: MemoryConfig = { ...DEFAULT_MEMORY };
  for (const [name, { key, min, max }] of Object.entries(LIMITS)) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    if (!/^\d+$/.test(raw.trim()) || value < min || value > max) throw new Error(`${name} precisa ser um inteiro de ${min} a ${max}.`);
    config[key] = value;
  }
  return config;
}

type Conversation = { id: number; scope: string; turns: { turn: Turn; size: number }[]; chars: number; lastUsed: number };

/** O recibo de quem começou uma pergunta. A resposta só entra se a conversa continua a mesma: sair ou "Nova conversa" no meio a descarta. */
export type Ticket = { id: number };

export function createMemory(config: MemoryConfig = DEFAULT_MEMORY, now: () => number = Date.now) {
  // O Map guarda a ordem de uso: a primeira chave é a usada há mais tempo.
  const conversations = new Map<string, Conversation>();
  let nextId = 1;
  const keyOf = (user: string, slug: string) => `${user}\n${slug}`;
  const expired = (conversation: Conversation) => now() - conversation.lastUsed >= config.idleMinutes * 60_000;

  function sweep() {
    for (const [key, conversation] of conversations) if (expired(conversation)) conversations.delete(key);
  }

  /** A conversa viva, ou nula. Esquece a vencida e a de outra permissão. */
  function find(user: string, slug: string, scope: string): Conversation | null {
    const key = keyOf(user, slug);
    const found = conversations.get(key);
    if (!found) return null;
    if (expired(found) || found.scope !== scope) {
      conversations.delete(key);
      return null;
    }
    return found;
  }

  const sizeOf = (turn: Turn) => turn.question.length + JSON.stringify(turn.answer).length + turn.screen.length;

  return {
    /** As trocas guardadas, para mostrar na tela. Não conta como uso. */
    peek(user: string, slug: string, scope: string): Turn[] {
      return find(user, slug, scope)?.turns.map((entry) => entry.turn) ?? [];
    },

    /** Começa uma pergunta: as trocas que entram como contexto, e o recibo para guardar a resposta. */
    begin(user: string, slug: string, scope: string): { history: Turn[]; ticket: Ticket } {
      sweep();
      let conversation = find(user, slug, scope);
      if (!conversation) {
        conversation = { id: nextId++, scope, turns: [], chars: 0, lastUsed: now() };
        // Cabe no teto: sai a usada há mais tempo.
        while (conversations.size >= config.maxConversations) conversations.delete(conversations.keys().next().value!);
      }
      const key = keyOf(user, slug);
      conversation.lastUsed = now();
      conversations.delete(key);
      conversations.set(key, conversation);
      return { history: conversation.turns.map((entry) => entry.turn), ticket: { id: conversation.id } };
    },

    /** Guarda a troca. Falso se a conversa acabou desde o começo da pergunta. */
    add(user: string, slug: string, ticket: Ticket, turn: Turn): boolean {
      const key = keyOf(user, slug);
      const conversation = conversations.get(key);
      if (!conversation || conversation.id !== ticket.id || expired(conversation)) return false;
      conversation.turns.push({ turn, size: sizeOf(turn) });
      conversation.chars += conversation.turns.at(-1)!.size;
      // As mais antigas saem primeiro, pelo número de trocas e pelo teto de caracteres. Uma troca maior que o teto sai também.
      while (conversation.turns.length > config.turns || conversation.chars > config.maxChars) {
        conversation.chars -= conversation.turns.shift()!.size;
      }
      conversation.lastUsed = now();
      conversations.delete(key);
      conversations.set(key, conversation);
      return true;
    },

    /** "Nova conversa" e o fim da sessão. */
    clear(user: string, slug: string) {
      conversations.delete(keyOf(user, slug));
    },

    clearUser(user: string) {
      for (const key of [...conversations.keys()]) if (key.startsWith(`${user}\n`)) conversations.delete(key);
    },

    size: () => conversations.size,
  };
}

export type Memory = ReturnType<typeof createMemory>;
