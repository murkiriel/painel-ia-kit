// A memória da conversa do agente, sozinha: isolamento, validade, tetos e configuração. O caminho pelo servidor está em portal.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemory, DEFAULT_MEMORY, readMemoryConfig, type MemoryConfig } from "../server/agent/memory.ts";
import type { Turn } from "../server/agent/types.ts";

const turn = (question: string, text = `resposta de ${question}`): Turn => ({
  question,
  answer: { status: "answered", text, sources: [], updatedAt: null, truncated: false, warnings: [] },
  screen: "sem filtros",
});

/** Um relógio que só anda quando o teste manda. */
function clock(start = 1_000_000) {
  let at = start;
  return { now: () => at, advance: (minutes: number) => { at += minutes * 60_000; } };
}

type Memory = ReturnType<typeof createMemory>;

function remember(memory: Memory, user: string, slug: string, scope: string, question: string) {
  const { ticket } = memory.begin(user, slug, scope);
  assert.equal(memory.add(user, slug, ticket, turn(question)), true);
}

const questions = (memory: Memory, user: string, slug: string, scope: string) => memory.peek(user, slug, scope).map((t) => t.question);

test("a conversa é de uma pessoa em um dashboard: outra pessoa e outro dashboard não a veem", () => {
  const memory = createMemory();
  remember(memory, "ana", "prazo", "todas", "e em agosto?");
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), ["e em agosto?"]);
  assert.deepEqual(memory.begin("bia", "prazo", "todas").history, []);
  assert.deepEqual(memory.begin("ana", "producao", "todas").history, []);
  // "ana" e "ana2" não se confundem.
  assert.deepEqual(memory.begin("ana2", "prazo", "todas").history, []);
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), ["e em agosto?"]);
});

test("se a permissão muda, a conversa começa do zero, e não volta se a permissão volta", () => {
  const memory = createMemory();
  remember(memory, "ana", "producao", "51", "primeira");
  assert.deepEqual(memory.begin("ana", "producao", "35,51").history, []);
  assert.deepEqual(questions(memory, "ana", "producao", "51"), []);
  assert.deepEqual(memory.begin("ana", "producao", "51").history, []);
});

test("guarda só as últimas trocas, com a pergunta e a resposta de cada uma", () => {
  const memory = createMemory({ ...DEFAULT_MEMORY, turns: 3 });
  for (const q of ["um", "dois", "tres", "quatro", "cinco"]) remember(memory, "ana", "prazo", "todas", q);
  const { history } = memory.begin("ana", "prazo", "todas");
  assert.deepEqual(history.map((t) => t.question), ["tres", "quatro", "cinco"]);
  assert.equal(history[2].answer.text, "resposta de cinco");
});

test("expira depois do tempo sem uso, e perguntar de novo renova o prazo", () => {
  const time = clock();
  const memory = createMemory({ ...DEFAULT_MEMORY, idleMinutes: 120 }, time.now);
  remember(memory, "ana", "prazo", "todas", "antiga");
  time.advance(119);
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), ["antiga"]);
  remember(memory, "ana", "prazo", "todas", "recente");
  time.advance(119);
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), ["antiga", "recente"]);
  time.advance(2);
  assert.deepEqual(memory.peek("ana", "prazo", "todas"), []);
  assert.deepEqual(memory.begin("ana", "prazo", "todas").history, []);
  assert.equal(memory.size(), 1); // a vencida saiu; só a que acabou de começar ficou
});

test("a conversa vencida some da memória mesmo que ninguém volte a ela", () => {
  const time = clock();
  const memory = createMemory({ ...DEFAULT_MEMORY, idleMinutes: 60 }, time.now);
  remember(memory, "ana", "prazo", "todas", "a");
  remember(memory, "bia", "prazo", "todas", "b");
  time.advance(61);
  memory.begin("caio", "prazo", "todas"); // qualquer pergunta varre as vencidas
  assert.equal(memory.size(), 1);
});

test("passou do teto de conversas, sai a usada há mais tempo", () => {
  const memory = createMemory({ ...DEFAULT_MEMORY, maxConversations: 3 });
  for (const user of ["a", "b", "c"]) remember(memory, user, "prazo", "todas", `de ${user}`);
  // "a" é usada de novo, então "b" passa a ser a mais antiga.
  remember(memory, "a", "prazo", "todas", "de novo");
  remember(memory, "d", "prazo", "todas", "de d");
  assert.equal(memory.size(), 3);
  assert.deepEqual(questions(memory, "b", "prazo", "todas"), []);
  assert.deepEqual(questions(memory, "a", "prazo", "todas"), ["de a", "de novo"]);
  assert.deepEqual(questions(memory, "c", "prazo", "todas"), ["de c"]);
  assert.deepEqual(questions(memory, "d", "prazo", "todas"), ["de d"]);
});

test("passou do teto de caracteres, saem as trocas mais antigas", () => {
  const memory = createMemory({ ...DEFAULT_MEMORY, maxChars: 1500 });
  for (const name of ["um", "dois", "tres"]) {
    const { ticket } = memory.begin("ana", "prazo", "todas");
    memory.add("ana", "prazo", ticket, turn(name, "x".repeat(600)));
  }
  // Cada troca pesa mais de 600 caracteres: só cabem duas.
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), ["dois", "tres"]);
  // Uma troca maior que o teto inteiro não fica.
  const { ticket } = memory.begin("ana", "prazo", "todas");
  memory.add("ana", "prazo", ticket, turn("enorme", "y".repeat(5000)));
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), []);
});

test("Nova conversa e sair esquecem a conversa, e uma resposta que chega depois não a traz de volta", () => {
  const memory = createMemory();
  remember(memory, "ana", "prazo", "todas", "a");
  remember(memory, "ana", "producao", "todas", "b");
  remember(memory, "bia", "prazo", "todas", "c");
  memory.clear("ana", "prazo");
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), []);
  assert.deepEqual(questions(memory, "ana", "producao", "todas"), ["b"]);
  memory.clearUser("ana");
  assert.deepEqual(questions(memory, "ana", "producao", "todas"), []);
  assert.deepEqual(questions(memory, "bia", "prazo", "todas"), ["c"]);

  // A pergunta começou, a pessoa saiu, e só depois o modelo respondeu.
  const { ticket } = memory.begin("ana", "prazo", "todas");
  memory.clearUser("ana");
  assert.equal(memory.add("ana", "prazo", ticket, turn("tarde")), false);
  assert.deepEqual(questions(memory, "ana", "prazo", "todas"), []);
  // O mesmo vale se a permissão mudou no meio.
  const second = memory.begin("ana", "prazo", "todas");
  memory.begin("ana", "prazo", "outra");
  assert.equal(memory.add("ana", "prazo", second.ticket, turn("tarde")), false);
});

test("a configuração tem padrão seguro, e valor inválido impede o servidor de subir", () => {
  assert.deepEqual(readMemoryConfig({}), { turns: 5, idleMinutes: 120, maxConversations: 200, maxChars: 20_000 });
  assert.deepEqual(readMemoryConfig({ AGENT_MEMORY_TURNS: "", AGENT_MEMORY_MAX_CHARS: " 5000 " }), { ...DEFAULT_MEMORY, maxChars: 5000 });
  const all: MemoryConfig = readMemoryConfig({ AGENT_MEMORY_TURNS: "3", AGENT_MEMORY_IDLE_MINUTES: "30", AGENT_MEMORY_MAX_CONVERSATIONS: "10", AGENT_MEMORY_MAX_CHARS: "4000" });
  assert.deepEqual(all, { turns: 3, idleMinutes: 30, maxConversations: 10, maxChars: 4000 });
  for (const [name, value] of [
    ["AGENT_MEMORY_TURNS", "0"], ["AGENT_MEMORY_TURNS", "21"], ["AGENT_MEMORY_TURNS", "cinco"], ["AGENT_MEMORY_TURNS", "2.5"], ["AGENT_MEMORY_TURNS", "-1"],
    ["AGENT_MEMORY_IDLE_MINUTES", "0"], ["AGENT_MEMORY_IDLE_MINUTES", "1441"],
    ["AGENT_MEMORY_MAX_CONVERSATIONS", "0"], ["AGENT_MEMORY_MAX_CONVERSATIONS", "5001"], ["AGENT_MEMORY_MAX_CONVERSATIONS", "1e3"],
    ["AGENT_MEMORY_MAX_CHARS", "999"], ["AGENT_MEMORY_MAX_CHARS", "200001"],
  ]) {
    assert.throws(() => readMemoryConfig({ [name]: value }), new RegExp(name), `${name}=${value}`);
  }
});
