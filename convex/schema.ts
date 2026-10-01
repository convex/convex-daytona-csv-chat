import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Everything the UI shows is a document here. The agent writes, the UI
// subscribes with useQuery, so you watch it work step by step with no
// polling, and a refresh mid-answer just picks up where it left off.
export default defineSchema({
  // One per uploaded CSV. Each chat gets its own Daytona sandbox.
  chats: defineTable({
    sessionId: v.string(),
    fileName: v.string(),
    fileId: v.id("_storage"),
    status: v.union(
      v.literal("starting"),
      v.literal("ready"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
    columns: v.optional(v.array(v.string())),
    previewRows: v.optional(v.array(v.array(v.string()))),
    rowCount: v.optional(v.number()),
    /** The first few raw lines, handed to the agent up front. */
    head: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    sandboxMs: v.optional(v.number()),
  }),

  messages: defineTable({
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    status: v.union(
      v.literal("thinking"),
      v.literal("done"),
      v.literal("error"),
    ),
    durationMs: v.optional(v.number()),
  }).index("by_chat", ["chatId"]),

  // One per run_python tool call: the code, what it printed, and any charts.
  steps: defineTable({
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    code: v.string(),
    status: v.union(v.literal("running"), v.literal("ok"), v.literal("error")),
    output: v.optional(v.string()),
    chartIds: v.array(v.id("_storage")),
    durationMs: v.optional(v.number()),
  }).index("by_chat", ["chatId"]),
});
