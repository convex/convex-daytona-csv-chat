import type { FunctionReturnType } from "convex/server";
import { Highlight, themes } from "prism-react-renderer";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { api } from "../convex/_generated/api";

type MessageDoc = FunctionReturnType<typeof api.chats.listMessages>[number];
type StepDoc = MessageDoc["steps"][number];

export function Message({ message }: { message: MessageDoc }) {
  if (message.role === "user") return <div className="bubble-user">{message.text}</div>;

  const thinking = message.status === "thinking";
  const charts = message.steps.flatMap((step) => step.chartUrls);
  return (
    <div className="answer">
      {thinking && <Status message={message} />}
      {message.text && (
        <div className={message.status === "error" ? "error" : "markdown"}>
          <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
        </div>
      )}
      {/* Charts are SVG from file storage. <img> never runs scripts inside an SVG. */}
      {charts.map((url) => (
        <img key={url} className="chart" src={url} alt="Chart drawn by the agent" />
      ))}
      {message.steps.length > 0 && <Steps steps={message.steps} live={thinking} />}
    </div>
  );
}

function Status({ message }: { message: MessageDoc }) {
  const running = message.steps.find((step) => step.status === "running");
  const text = running
    ? `Running Python in the sandbox (step ${message.steps.length})…`
    : message.steps.length === 0
      ? "Thinking…"
      : message.text
        ? "Writing the answer…"
        : "Reading the output…";
  return (
    <div className="status">
      <span className="spinner" />
      {text}
    </div>
  );
}

/** The showcase: every snippet the agent ran, with its output, live as it happens. */
function Steps({ steps, live }: { steps: StepDoc[]; live: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? live;
  const seconds = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0) / 1000;
  return (
    <div className="steps">
      <button className="steps-toggle" onClick={() => setToggled(!open)}>
        <span className={`caret ${open ? "open" : ""}`}>▸</span>
        Python that ran in the sandbox
        <span className="muted">
          {steps.length} {steps.length === 1 ? "run" : "runs"}
          {seconds > 0 && ` · ${seconds.toFixed(1)}s`}
        </span>
      </button>
      {open && steps.map((step, i) => <Step key={step._id} step={step} index={i + 1} />)}
    </div>
  );
}

function Step({ step, index }: { step: StepDoc; index: number }) {
  return (
    <div className={`step step-${step.status}`}>
      <div className="step-header">
        <span>Step {index}</span>
        <span className="step-status">
          {step.status === "running"
            ? "running…"
            : `${step.status === "ok" ? "✓ ok" : "✗ error"} · ${((step.durationMs ?? 0) / 1000).toFixed(1)}s`}
        </span>
      </div>
      <Highlight theme={themes.oneDark} code={step.code.trim()} language="python">
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="code">
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                <span className="line-no">{i + 1}</span>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
      {step.output !== undefined && (
        <pre className="output">{step.output.trim() || "(no output)"}</pre>
      )}
    </div>
  );
}
