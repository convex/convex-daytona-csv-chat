import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Chat } from "./Chat";
import { getSessionId, useStoredState } from "./session";
import { Upload } from "./Upload";

const REPO_URL = "https://github.com/get-convex/convex-daytona-csv-chat";
const sessionId = getSessionId();

export default function App() {
  const [chatId, setChatId] = useStoredState("chatId");
  const chat = useQuery(api.chats.getChat, chatId ? { sessionId, chatId } : "skip");

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <h1>CSV Chat</h1>
          <span className="badge">Convex + Daytona</span>
        </div>
        <a className="github" href={REPO_URL} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </header>

      <main className="main">
        {chatId && chat === undefined ? null : chat ? (
          <Chat sessionId={sessionId} chat={chat} onNewFile={() => setChatId(null)} />
        ) : (
          <Upload sessionId={sessionId} onChat={setChatId} />
        )}
      </main>

      <footer className="footer">
        Public demo. Everything resets every 12 hours. Run your own:{" "}
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          github.com/get-convex/convex-daytona-csv-chat
        </a>
      </footer>
    </div>
  );
}
