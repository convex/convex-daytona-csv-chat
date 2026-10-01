import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import {
  ANSWER_TIMEOUT_MS,
  MAX_FILE_BYTES,
  MAX_QUESTION_CHARS,
  limit,
} from "./limits";
import { assertSandboxCapacity, daytona } from "./sandbox";

// The browser keeps a random session id in localStorage. Everything is scoped
// to it. It's spoofable, which is why limits.ts also has global limits.
const sessionId = v.string();

// Chat ids come from the browser's localStorage, so treat them as plain
// strings: a stale or garbled id just means "no chat".
const chatId = v.string();

async function getOwnedChat(
  ctx: QueryCtx,
  args: { sessionId: string; chatId: string },
) {
  const id = ctx.db.normalizeId("chats", args.chatId);
  const chat = id && (await ctx.db.get("chats", id));
  return chat && chat.sessionId === args.sessionId ? chat : null;
}

// ---------- Upload a CSV ----------

export const generateUploadUrl = mutation({
  args: { sessionId },
  handler: async (ctx, args) => {
    await limit(ctx, "upload", args.sessionId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createChat = mutation({
  args: { sessionId, fileId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, args) => {
    const file = await ctx.db.system.get("_storage", args.fileId);
    if (!file) throw new ConvexError("Upload not found. Try again.");
    const problem = !args.fileName.toLowerCase().endsWith(".csv")
      ? "Only .csv files are supported."
      : file.size > MAX_FILE_BYTES
        ? "That file is over 1 MB. Try a smaller CSV."
        : null;
    if (problem) {
      await ctx.storage.delete(args.fileId);
      throw new ConvexError(problem);
    }
    await assertSandboxCapacity(ctx);
    const chatId = await ctx.db.insert("chats", {
      sessionId: args.sessionId,
      fileName: args.fileName.slice(0, 100),
      fileId: args.fileId,
      status: "starting",
    });
    await ctx.scheduler.runAfter(0, internal.agent.setupChat, { chatId });
    return chatId;
  },
});

// ---------- Read the chat (the UI subscribes to these) ----------

export const getChat = query({
  args: { sessionId, chatId },
  handler: async (ctx, args) => {
    const chat = await getOwnedChat(ctx, args);
    if (!chat) return null;
    // The component's sandbox table is reactive too: its state shows live in the header.
    const sandbox = chat.sandboxId
      ? await daytona.getSandbox(ctx, { sandboxId: chat.sandboxId })
      : null;
    return { ...chat, head: undefined, sandboxState: sandbox?.state };
  },
});

export const listMessages = query({
  args: { sessionId, chatId },
  handler: async (ctx, args) => {
    const chat = await getOwnedChat(ctx, args);
    if (!chat) return [];
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
      .take(200);
    const steps = await ctx.db
      .query("steps")
      .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
      .take(500);
    return await Promise.all(
      messages.map(async (message) => ({
        ...message,
        steps: await Promise.all(
          steps
            .filter((step) => step.messageId === message._id)
            .map(async (step) => ({
              ...step,
              chartUrls: (
                await Promise.all(step.chartIds.map((id) => ctx.storage.getUrl(id)))
              ).filter((url) => url !== null),
            })),
        ),
      })),
    );
  },
});

// ---------- Ask a question ----------

export const ask = mutation({
  args: { sessionId, chatId, question: v.string() },
  handler: async (ctx, args) => {
    const chat = await getOwnedChat(ctx, args);
    if (!chat) throw new ConvexError("Chat not found. It may have been reset.");
    if (chat.status !== "ready") throw new ConvexError("The sandbox isn't ready yet.");
    const question = args.question.trim();
    if (!question) throw new ConvexError("Ask a question first.");
    if (question.length > MAX_QUESTION_CHARS) {
      throw new ConvexError(`Keep questions under ${MAX_QUESTION_CHARS} characters.`);
    }
    const last = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
      .order("desc")
      .first();
    if (last?.status === "thinking") {
      throw new ConvexError("Still working on the last question.");
    }
    await limit(ctx, "question", args.sessionId);

    await ctx.db.insert("messages", {
      chatId: chat._id,
      role: "user",
      text: question,
      status: "done",
    });
    const messageId = await ctx.db.insert("messages", {
      chatId: chat._id,
      role: "assistant",
      text: "",
      status: "thinking",
    });
    // The agent runs in the background, so closing the tab doesn't stop it.
    await ctx.scheduler.runAfter(0, internal.agent.answer, { messageId });
    // Watchdog: never leave a message spinning forever if the action dies.
    await ctx.scheduler.runAfter(ANSWER_TIMEOUT_MS, internal.chats.finishAnswer, {
      messageId,
      status: "error",
      text: "This answer timed out. Try asking again.",
      onlyIfThinking: true,
    });
  },
});

// ---------- Internal: called by the agent in agent.ts ----------

export const getChatInternal = internalQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => await ctx.db.get("chats", args.chatId),
});

export const updateChat = internalMutation({
  args: {
    chatId: v.id("chats"),
    status: v.optional(v.union(v.literal("ready"), v.literal("error"))),
    error: v.optional(v.string()),
    columns: v.optional(v.array(v.string())),
    previewRows: v.optional(v.array(v.array(v.string()))),
    rowCount: v.optional(v.number()),
    head: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    sandboxMs: v.optional(v.number()),
  },
  handler: async (ctx, { chatId, ...fields }) => {
    if (await ctx.db.get("chats", chatId)) await ctx.db.patch("chats", chatId, fields);
  },
});

/** Everything the agent needs to answer: the chat, the question and earlier turns. */
export const loadForAnswer = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    const chat = message && (await ctx.db.get("chats", message.chatId));
    if (!message || !chat) throw new Error("Message or chat was deleted");
    const earlier = await ctx.db
      .query("messages")
      .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
      .order("desc")
      .take(13);
    const history = earlier
      .reverse()
      .filter((m) => m._id !== message._id && m.status === "done")
      .map((m) => ({ role: m.role, content: m.text }));
    return { chat, history };
  },
});

export const updateAnswer = internalMutation({
  args: { messageId: v.id("messages"), text: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (message?.status === "thinking") {
      await ctx.db.patch("messages", args.messageId, { text: args.text });
    }
  },
});

export const finishAnswer = internalMutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(v.literal("done"), v.literal("error")),
    text: v.string(),
    onlyIfThinking: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (!message || (args.onlyIfThinking && message.status !== "thinking")) return;
    await ctx.db.patch("messages", args.messageId, {
      status: args.status,
      text: args.text,
      durationMs: Date.now() - message._creationTime,
    });
  },
});

export const startStep = internalMutation({
  args: { messageId: v.id("messages"), code: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.db.get("messages", args.messageId);
    if (!message) throw new Error("Message was deleted");
    return await ctx.db.insert("steps", {
      chatId: message.chatId,
      messageId: message._id,
      code: args.code,
      status: "running",
      chartIds: [],
    });
  },
});

export const finishStep = internalMutation({
  args: {
    stepId: v.id("steps"),
    status: v.union(v.literal("ok"), v.literal("error")),
    output: v.string(),
    chartIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, { stepId, ...fields }) => {
    const step = await ctx.db.get("steps", stepId);
    if (!step) return;
    await ctx.db.patch("steps", stepId, {
      ...fields,
      durationMs: Date.now() - step._creationTime,
    });
  },
});
