// O texto da resposta do agente, num subconjunto seguro de Markdown: **negrito**, listas com marcador e parágrafos.
// Só devolve dados (blocos e trechos). Quem monta a tela cria elementos React, nunca HTML: nada do modelo vira marcação.

export type Inline = { text: string; bold: boolean };
export type Block = { type: "paragraph"; lines: Inline[][] } | { type: "list"; items: Inline[][] };

/** Negrito é **texto** na mesma linha. ** sem par fica como texto, para a resposta nunca perder uma palavra. */
export function parseInline(line: string): Inline[] {
  const parts: Inline[] = [];
  const bold = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
  let last = 0;
  for (const match of line.matchAll(bold)) {
    if (match.index > last) parts.push({ text: line.slice(last, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), bold: false });
  return parts;
}

const ITEM = /^\s*[-*•]\s+(.*\S)\s*$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph.map(parseInline) });
    if (list.length) blocks.push({ type: "list", items: list.map(parseInline) });
    paragraph = [];
    list = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      // Lista começa depois de um parágrafo: o parágrafo fecha, mesmo sem linha em branco.
      if (paragraph.length) flush();
      list.push(item[1]);
    } else {
      if (list.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export type Memory = { turns: number; idleMinutes: number };

/** O tempo sem uso: "2 horas", "1 hora" ou "45 minutos". */
export const idleText = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hora" : "horas"}` : `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;

/** O que a conversa lembra, com os números da configuração do servidor. */
export const memoryText = ({ turns, idleMinutes }: Memory) =>
  `Lembra ${turns === 1 ? "da última pergunta" : `das últimas ${turns} perguntas`} desta conversa por até ${idleText(idleMinutes)} sem uso.`;
