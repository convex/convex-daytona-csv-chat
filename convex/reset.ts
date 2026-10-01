import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { APP_NAME } from "./limits";
import { daytona } from "./sandbox";

/**
 * Runs every 12 hours (see crons.ts), and is safe to run by hand any time:
 *   npx convex run reset:resetDemo
 * Deletes this app's sandboxes, then wipes the tables and uploaded files.
 */
export const resetDemo = internalAction({
  args: {},
  handler: async (ctx) => {
    const sandboxIds = await ctx.runQuery(internal.reset.sandboxesToDelete, {});
    for (const sandboxId of sandboxIds) {
      try {
        await daytona.deleteSandbox(ctx, { sandboxId });
      } catch {
        // Already gone on Daytona's side (e.g. auto-deleted): refresh marks it destroyed.
        await daytona.refreshSandbox(ctx, { sandboxId }).catch(() => null);
      }
    }
    let deleted = 0;
    let batch: number;
    do {
      batch = await ctx.runMutation(internal.reset.wipeBatch, {});
      deleted += batch;
    } while (batch > 0);
    console.log(`Reset: ${sandboxIds.length} sandboxes, ${deleted} docs and files deleted`);
  },
});

export const sandboxesToDelete = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sandboxes = await daytona.listSandboxes(ctx, { limit: 500 });
    return sandboxes
      .filter((s) => s.state !== "destroyed" && s.labels?.app === APP_NAME)
      .map((s) => s.sandboxId);
  },
});

export const wipeBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of ["steps", "messages", "chats"] as const) {
      for (const doc of await ctx.db.query(table).take(200)) {
        await ctx.db.delete(table, doc._id);
        deleted++;
      }
    }
    for (const file of await ctx.db.system.query("_storage").take(200)) {
      await ctx.storage.delete(file._id);
      deleted++;
    }
    return deleted;
  },
});
