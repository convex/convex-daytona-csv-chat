import { useMutation } from "convex/react";
import { useState, type DragEvent } from "react";
import { api } from "../convex/_generated/api";
import { errorText } from "./session";

export const SAMPLE_FILE = "sample-store-sales.csv";
const MAX_BYTES = 1024 * 1024;

export function Upload(props: { sessionId: string; onChat: (chatId: string) => void }) {
  const generateUploadUrl = useMutation(api.chats.generateUploadUrl);
  const createChat = useMutation(api.chats.createChat);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: Blob, fileName: string) {
    setError(null);
    if (!fileName.toLowerCase().endsWith(".csv")) return setError("Only .csv files are supported.");
    if (file.size > MAX_BYTES) return setError("That file is over 1 MB. Try a smaller CSV.");
    setBusy(true);
    try {
      // Upload straight to Convex file storage, then hand the storage id to a mutation.
      const url = await generateUploadUrl({ sessionId: props.sessionId });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: file,
      });
      const { storageId } = await response.json();
      props.onChat(await createChat({ sessionId: props.sessionId, fileId: storageId, fileName }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function trySample() {
    const blob = await (await fetch(`/${SAMPLE_FILE}`)).blob();
    await upload(blob, SAMPLE_FILE);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file, file.name);
  }

  return (
    <section className="upload">
      <h2>Ask questions about any CSV</h2>
      <p className="lede">
        An AI agent on Convex writes Python, runs it in a Daytona sandbox with pandas and
        matplotlib, reads the output and answers you, with a chart when it helps.
      </p>

      <label
        className={`dropzone ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file, file.name);
          }}
        />
        <span className="dropzone-title">{busy ? "Uploading…" : "Drop a CSV here or click to choose"}</span>
        <span className="muted">Up to 1 MB</span>
      </label>

      <div className="or">or</div>
      <button className="button primary" disabled={busy} onClick={() => void trySample()}>
        Try with sample data
      </button>
      <p className="muted small">A year of online store sales: 1,245 orders with date, product, category, region, units and revenue.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
