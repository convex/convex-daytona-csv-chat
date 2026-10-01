import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../convex/_generated/api";
import { Message } from "./Message";
import { errorText } from "./session";
import { SAMPLE_FILE } from "./Upload";

type ChatDoc = NonNullable<FunctionReturnType<typeof api.chats.getChat>>;

const MAX_CHARS = 500;
const SAMPLE_QUESTIONS = [
  "Which month had the most revenue?",
  "Chart revenue by category",
  "Any weird outliers?",
  "How do regions compare on average order value?",
];
const GENERIC_QUESTIONS = [
  "Give me a quick summary of this data",
  "Chart the most interesting trend",
  "Any weird outliers?",
];

export function Chat(props: { sessionId: string; chat: ChatDoc; onNewFile: () => void }) {
  const { chat, sessionId } = props;
  const messages = useQuery(api.chats.listMessages, { sessionId, chatId: chat._id });
  const ask = useMutation(api.chats.ask);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const busy = messages?.at(-1)?.status === "thinking";
  const ready = chat.status === "ready" && !busy;
  const lastMessage = messages?.at(-1);
  const scrollKey = `${messages?.length}-${lastMessage?.steps.length}-${lastMessage?.status}`;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [scrollKey]);

  async function send(text: string) {
    setError(null);
    try {
      await ask({ sessionId, chatId: chat._id, question: text });
      setQuestion("");
    } catch (err) {
      setError(errorText(err));
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (question.trim()) void send(question);
  }

  const suggestions = chat.fileName === SAMPLE_FILE ? SAMPLE_QUESTIONS : GENERIC_QUESTIONS;

  return (
    <section className="chat">
      <div className="file-bar">
        <div>
          <div className="file-name">{chat.fileName}</div>
          <div className="muted small">
            {chat.rowCount !== undefined
              ? `${chat.rowCount.toLocaleString()} rows · ${chat.columns?.length} columns`
              : "Reading file…"}
          </div>
        </div>
        <SandboxPill chat={chat} />
        <button className="button ghost" onClick={props.onNewFile}>
          New file
        </button>
      </div>

      {chat.status === "error" && <p className="error">{chat.error}</p>}

      {chat.columns && chat.previewRows && (
        <details className="preview">
          <summary>Preview the data</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{chat.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {chat.previewRows.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="messages">
        {messages?.map((message) => <Message key={message._id} message={message} />)}
        {messages?.length === 0 && chat.status !== "error" && (
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s} className="chip" disabled={!ready} onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <input
          value={question}
          maxLength={MAX_CHARS}
          placeholder={chat.status === "starting" ? "Starting the sandbox…" : "Ask about your data…"}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <span className="counter">{question.length}/{MAX_CHARS}</span>
        <button className="button primary" disabled={!ready || !question.trim()}>
          {busy ? "Working…" : "Ask"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function SandboxPill({ chat }: { chat: ChatDoc }) {
  const state = chat.status === "starting" ? "starting" : chat.sandboxState ?? chat.status;
  const label =
    chat.status === "starting"
      ? "Creating sandbox…"
      : `Sandbox ${state}${chat.sandboxMs ? ` · ready in ${(chat.sandboxMs / 1000).toFixed(1)}s` : ""}`;
  return (
    <div className={`pill pill-${state}`}>
      <span className="dot" />
      {label}
    </div>
  );
}
