import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { stepCountIs, streamText, tool } from "ai";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { inspectCsv } from "./csv";
import { MAX_OUTPUT_TOKENS, MAX_TOOL_CALLS } from "./limits";
import {
  CHART_DIR,
  CSV_PATH,
  assertSandboxCapacity,
  collectCharts,
  createSandbox,
  runPython,
  sandboxExists,
} from "./sandbox";

const MODEL = "anthropic/claude-sonnet-5";

/** After upload: check the file really is a CSV, then start its sandbox. */
export const setupChat = internalAction({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const chat = await ctx.runQuery(internal.chats.getChatInternal, { chatId });
    if (!chat) return;
    try {
      const csv = await readCsv(ctx, chat.fileId);
      await ctx.runMutation(internal.chats.updateChat, { chatId, ...inspectCsv(csv) });
      const started = Date.now();
      const sandboxId = await createSandbox(ctx, { sessionId: chat.sessionId, csv });
      await ctx.runMutation(internal.chats.updateChat, {
        chatId,
        sandboxId,
        sandboxMs: Date.now() - started,
        status: "ready",
      });
    } catch (error) {
      await ctx.runMutation(internal.chats.updateChat, {
        chatId,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

async function readCsv(ctx: ActionCtx, fileId: Id<"_storage">) {
  const blob = await ctx.storage.get(fileId);
  if (!blob) throw new Error("The uploaded file is gone.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer());
  } catch {
    throw new Error("That file isn't UTF-8 text, so it can't be a CSV.");
  }
}

/** Sandboxes auto-delete after an hour idle, so recreate one if it's gone. */
async function ensureSandbox(ctx: ActionCtx, chat: Doc<"chats">) {
  if (chat.sandboxId && (await sandboxExists(ctx, chat.sandboxId))) {
    return chat.sandboxId;
  }
  await ctx.runQuery(internal.agent.checkCapacity, {});
  const csv = await readCsv(ctx, chat.fileId);
  const sandboxId = await createSandbox(ctx, { sessionId: chat.sessionId, csv });
  await ctx.runMutation(internal.chats.updateChat, { chatId: chat._id, sandboxId });
  return sandboxId;
}

/** The agent loop: the model writes Python, Daytona runs it, repeat, then answer. */
export const answer = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    try {
      const { chat, history } = await ctx.runQuery(internal.chats.loadForAnswer, {
        messageId,
      });
      const sandboxId = await ensureSandbox(ctx, chat);

      let streamError: unknown;
      const result = streamText({
        model: convexGateway(MODEL),
        instructions: instructions(chat),
        messages: history,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        tools: {
          run_python: tool({
            description:
              "Run Python 3 in the sandbox and get back everything it printed (or the traceback).",
            inputSchema: z.object({ code: z.string() }),
            execute: async ({ code }) => {
              const stepId = await ctx.runMutation(internal.chats.startStep, {
                messageId,
                code,
              });
              const { ok, output } = await runPython(ctx, sandboxId, code);
              const chartIds = await collectCharts(ctx, sandboxId);
              const trimmed = output.length > 6000 ? `${output.slice(0, 6000)}\n…[truncated]` : output;
              await ctx.runMutation(internal.chats.finishStep, {
                stepId,
                status: ok ? "ok" : "error",
                output: trimmed,
                chartIds,
              });
              const charts = chartIds.length
                ? `\n[${chartIds.length} chart(s) saved and shown to the user]`
                : "";
              return `${ok ? "" : "ERROR\n"}${trimmed || "(no output)"}${charts}`;
            },
          }),
        },
        // Up to MAX_TOOL_CALLS runs, then one last step that must answer in words.
        stopWhen: stepCountIs(MAX_TOOL_CALLS + 1),
        prepareStep: ({ stepNumber }) =>
          stepNumber >= MAX_TOOL_CALLS ? { toolChoice: "none" } : {},
        // streamText doesn't throw on provider errors; it ends the stream empty.
        onError: ({ error }) => {
          streamError = error;
        },
      });

      // Stream the answer into the message so the UI shows it as it's written.
      // Text from steps that ended in a tool call is just narration: drop it.
      let text = "";
      let lastPatch = 0;
      for await (const part of result.stream) {
        if (part.type === "start-step") text = "";
        if (part.type === "text-delta") {
          text += part.text;
          if (Date.now() - lastPatch > 250) {
            lastPatch = Date.now();
            await ctx.runMutation(internal.chats.updateAnswer, { messageId, text });
          }
        }
      }
      if (streamError || !text.trim()) {
        throw new Error(`The model didn't answer: ${errorMessage(streamError)}`);
      }
      await ctx.runMutation(internal.chats.finishAnswer, {
        messageId,
        status: "done",
        text,
      });
    } catch (error) {
      await ctx.runMutation(internal.chats.finishAnswer, {
        messageId,
        status: "error",
        text: errorMessage(error),
      });
    }
  },
});

/** Lets the action run the (query-only) concurrency check before creating a sandbox. */
export const checkCapacity = internalQuery({
  args: {},
  handler: async (ctx) => await assertSandboxCapacity(ctx),
});

function instructions(chat: Doc<"chats">) {
  return `You are a friendly data analyst. The user uploaded "${chat.fileName}" (${chat.rowCount} rows). It's saved at ${CSV_PATH} in a sandbox where you can run Python with the run_python tool. pandas, numpy, matplotlib and seaborn are installed. Don't install anything.

Columns: ${chat.columns?.join(", ")}
First lines of the file:
\`\`\`csv
${chat.head}
\`\`\`

How to work:
- Every run_python call is a fresh Python process, so load the CSV each time: df = pd.read_csv("${CSV_PATH}").
- Only what you print() comes back to you. Print compact results (aggregates, top rows), not whole tables.
- You have at most ${MAX_TOOL_CALLS} runs per question, so do as much as you can in each one. Usually one or two is enough.
- If the code fails, read the traceback, fix it and run it again.
- When a chart would help (trends, comparisons, distributions, or when asked), save ONE chart as SVG: plt.savefig("${CHART_DIR}/chart.svg") then plt.close(). It is shown to the user under your answer. A dark theme and colour palette are already configured: don't set styles, themes or colours, and never call plt.show(). Give it a clear title and axis labels.

Then answer in plain words: short (under 120 words) and specific, with the key numbers. Light markdown is fine (bold, short lists). Don't paste code or mention file paths: the user can already see the code you ran.`;
}

function errorMessage(error: unknown) {
  if (error instanceof ConvexError) return String(error.data);
  const err = error as { message?: string; error?: { message?: string } } | undefined;
  return err?.message ?? err?.error?.message ?? "no text came back";
}
