import { useEffect, useRef, useState, type FormEvent } from "react";
import { dateTime } from "../../../shared/format.ts";
import { api } from "../api.ts";
import { memoryText, parseBlocks, type Inline, type Memory } from "../chatText.ts";

type Source = { indicator: string; period: string; filters: Record<string, string> };
type Answer = {
  status: "answered" | "refused" | "failed";
  text: string;
  sources: Source[];
  updatedAt: string | null;
  truncated: boolean;
  warnings: string[];
};
type Status = { enabled: boolean; simulated: boolean; memory: Memory; conversation: { question: string; answer: Answer }[] };
type Message = { id: number; role: "user"; text: string } | { id: number; role: "agent"; answer: Answer } | { id: number; role: "error"; text: string };

const describe = (source: Source) => {
  const filters = Object.entries(source.filters).map(([name, value]) => `${name}: ${value}`).join(", ");
  return `${source.indicator} · ${source.period}${filters ? ` · ${filters}` : ""}`;
};

const inline = (parts: Inline[]) => parts.map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : part.text));

/** O texto da resposta: negrito, listas e parágrafos. Tudo vira elemento React, e o resto continua texto puro. */
function ChatText({ text }: { text: string }) {
  return parseBlocks(text).map((block, i) =>
    block.type === "list"
      ? <ul key={i} className="chat-list">{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>
      : <p key={i}>{block.lines.map((line, j) => <span key={j}>{j > 0 && <br />}{inline(line)}</span>)}</p>,
  );
}

function AgentMessage({ answer }: { answer: Answer }) {
  return (
    <div className="chat-message chat-agent">
      <ChatText text={answer.text} />
      {answer.warnings.map((warning) => <p key={warning} className="chat-note chat-warning">{warning}</p>)}
      {answer.truncated && <p className="chat-note">O resultado foi cortado: mostra só as primeiras linhas.</p>}
      {answer.sources.map((source, i) => <p key={i} className="chat-note">Origem: {describe(source)}</p>)}
      {answer.updatedAt && <p className="chat-note">Última atualização: {dateTime(answer.updatedAt)}</p>}
    </div>
  );
}

/** Botão flutuante no canto inferior direito, que abre a janela de chat. Só aparece quando o projeto liga um provedor. */
export function AgentPanel({ query, scope, help, placeholder }: { query: string; scope: string; help: string; placeholder: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const wasOpen = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // A conversa vive no servidor: a tela mostra o que ele guardou, ao carregar a página e a cada vez que o chat abre.
  const sync = (current: { cancelled: boolean }) =>
    api<Status>("agent")
      .then((loaded) => {
        if (current.cancelled) return;
        setStatus(loaded);
        setMessages(loaded.conversation.flatMap(({ question, answer }): Message[] => [
          { id: nextId.current++, role: "user", text: question },
          { id: nextId.current++, role: "agent", answer },
        ]));
      })
      .catch(() => {
        if (!current.cancelled) setStatus(null);
      });

  useEffect(() => {
    const current = { cancelled: false };
    void sync(current);
    return () => {
      current.cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open || busy) return;
    const current = { cancelled: false };
    void sync(current);
    return () => {
      current.cancelled = true;
    };
    // Só ao abrir: depois, quem muda a conversa é esta tela, e o servidor guarda o mesmo.
  }, [open]);

  // O foco vai para a pergunta ao abrir e volta para o botão ao fechar, quando ele já está na tela.
  useEffect(() => {
    if (open) input.current?.focus();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  if (!status?.enabled) return null;

  const close = () => setOpen(false);

  const add = (message: Omit<Message, "id"> & Partial<Message>) => {
    const id = nextId.current++;
    setMessages((current) => [...current, { ...message, id } as Message]);
  };

  const restart = async () => {
    if (busy) return;
    try {
      await api("agent", { method: "DELETE" });
      setMessages([]);
    } catch (error) {
      add({ role: "error", text: `Não foi possível começar outra conversa. ${(error as Error).message}` });
    }
    input.current?.focus();
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setQuestion("");
    setBusy(true);
    add({ role: "user", text });
    try {
      add({ role: "agent", answer: await api<Answer>("agent", { body: { question: text, query } }) });
    } catch (error) {
      add({ role: "error", text: `Não foi possível responder. ${(error as Error).message}` });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <>
      {!open && (
        <button ref={opener} className="chat-button" type="button" aria-expanded={false} onClick={() => setOpen(true)}>
          Perguntar aos dados
        </button>
      )}
      {open && (
        <section
          className="chat-window"
          role="dialog"
          aria-label="Perguntar aos dados"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <header className="chat-header">
            <strong>Perguntar aos dados{status.simulated ? " (simulado)" : ""}</strong>
            <button type="button" className="chat-restart" disabled={busy || messages.length === 0} onClick={restart}>Nova conversa</button>
            <button type="button" aria-label="Fechar o chat" onClick={close}>×</button>
          </header>
          <div className="chat-messages" aria-live="polite">
            <p className="chat-note">{help} {memoryText(status.memory)} Não digite dados pessoais: a pergunta vai para o provedor de IA.</p>
            {messages.map((message) =>
              message.role === "agent"
                ? <AgentMessage key={message.id} answer={message.answer} />
                : <p key={message.id} className={message.role === "user" ? "chat-message chat-user" : "chat-message chat-error"}>{message.text}</p>,
            )}
            {busy && <p className="chat-note">Consultando...</p>}
            <div ref={end} />
          </div>
          {scope && <p className="chat-scope">Filtros atuais: {scope}</p>}
          <form className="chat-form" onSubmit={send}>
            <input
              ref={input}
              aria-label="Pergunta"
              maxLength={500}
              value={question}
              placeholder={placeholder}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button type="submit" disabled={busy || question.trim() === ""}>Enviar</button>
          </form>
        </section>
      )}
    </>
  );
}
