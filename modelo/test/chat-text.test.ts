// O texto do chat: o subconjunto de Markdown que a tela mostra, e o texto de abertura.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { idleText, memoryText, parseBlocks, parseInline } from "../web/src/chatText.ts";

const plain = (text: string) => parseBlocks(text).map((block) =>
  block.type === "list"
    ? { list: block.items.map((item) => item.map((part) => (part.bold ? `*${part.text}*` : part.text)).join("")) }
    : { p: block.lines.map((line) => line.map((part) => (part.bold ? `*${part.text}*` : part.text)).join("")) },
);

test("negrito vira trecho em negrito, sem os asteriscos", () => {
  assert.deepEqual(parseInline("é **63,2%** do total"), [{ text: "é ", bold: false }, { text: "63,2%", bold: true }, { text: " do total", bold: false }]);
  assert.deepEqual(parseInline("**-21,8 p.p.** abaixo"), [{ text: "-21,8 p.p.", bold: true }, { text: " abaixo", bold: false }]);
  assert.deepEqual(parseInline("sem negrito"), [{ text: "sem negrito", bold: false }]);
});

test("asterisco sem par ou colado em espaço fica como texto: a resposta nunca perde palavra", () => {
  for (const text of ["2 ** 3", "**sem fechar", "fechou** sem abrir", "** **", "a * b * c"]) {
    assert.equal(parseInline(text).map((part) => part.text).join(""), text, text);
    assert.ok(parseInline(text).every((part) => !part.bold), text);
  }
});

test("itens com marcador viram lista, mesmo logo depois de um parágrafo, e a linha em branco separa parágrafos", () => {
  assert.deepEqual(plain("Intro **63,2%**.\n- A conta é 115 de 182.\n- Ficam fora 22.\n\nFim."), [
    { p: ["Intro *63,2%*."] },
    { list: ["A conta é 115 de 182.", "Ficam fora 22."] },
    { p: ["Fim."] },
  ]);
  assert.deepEqual(plain("* um\n• dois\n- três"), [{ list: ["um", "dois", "três"] }]);
  assert.deepEqual(plain("linha 1\nlinha 2\n\n\nlinha 3"), [{ p: ["linha 1", "linha 2"] }, { p: ["linha 3"] }]);
  // Negrito no começo da linha não é item de lista.
  assert.deepEqual(plain("**Resumo** do prazo"), [{ p: ["*Resumo* do prazo"] }]);
});

test("todo o resto continua texto puro: HTML, links, títulos e código não viram marcação", () => {
  const text = "<b>oi</b> <script>alert(1)</script> [link](http://x.y) # título `código` ![img](a.png)";
  assert.deepEqual(plain(text), [{ p: [text] }]);
  assert.deepEqual(plain("# Título\n1. um\n2. dois"), [{ p: ["# Título", "1. um", "2. dois"] }]);
  assert.deepEqual(plain(""), []);
  assert.deepEqual(plain("\n\n  \n"), []);
});

test("o texto de abertura diz a memória da conversa com os números da configuração", () => {
  assert.equal(memoryText({ turns: 5, idleMinutes: 120 }), "Lembra das últimas 5 perguntas desta conversa por até 2 horas sem uso.");
  assert.equal(memoryText({ turns: 1, idleMinutes: 60 }), "Lembra da última pergunta desta conversa por até 1 hora sem uso.");
  assert.equal(idleText(45), "45 minutos");
  assert.equal(idleText(1), "1 minuto");
});

test("o aviso de dados pessoais aparece uma vez só: o chat o acrescenta, e o texto de ajuda de cada dashboard não o repete", () => {
  const panel = readFileSync(new URL("../web/src/components/AgentPanel.tsx", import.meta.url), "utf8");
  assert.equal(panel.match(/dados pessoais/g)?.length, 1);
  for (const slug of ["producao-agricola"]) {
    const indicators = readFileSync(new URL(`../dashboards/${slug}/web/indicators.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(indicators.split("\n").filter((line) => /^\s*agent:/.test(line)).join(""), /dados pessoais/i, slug);
  }
});
