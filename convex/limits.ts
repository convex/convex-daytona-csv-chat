import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";

// Every knob that protects the public demo lives here. Tweak freely for your own copy.
export const APP_NAME = "convex-daytona-csv-chat";
export const QUESTIONS_PER_SESSION_PER_HOUR = 6;
export const QUESTIONS_GLOBAL_PER_HOUR = 60;
export const UPLOADS_PER_SESSION_PER_HOUR = 5;
export const UPLOADS_GLOBAL_PER_HOUR = 60;
export const MAX_LIVE_SANDBOXES = 8;
export const MAX_QUESTION_CHARS = 500;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TOOL_CALLS = 4;
export const MAX_OUTPUT_TOKENS = 2000;
export const PYTHON_TIMEOUT_SECONDS = 60;
export const SANDBOX_AUTO_STOP_MINUTES = 10;
export const SANDBOX_AUTO_DELETE_MINUTES = 60;
export const ANSWER_TIMEOUT_MS = 5 * 60 * 1000;

const rateLimiter = new RateLimiter(components.rateLimiter, {
  questionPerSession: {
    kind: "token bucket",
    rate: QUESTIONS_PER_SESSION_PER_HOUR,
    period: HOUR,
  },
  questionGlobal: {
    kind: "token bucket",
    rate: QUESTIONS_GLOBAL_PER_HOUR,
    period: HOUR,
  },
  uploadPerSession: {
    kind: "token bucket",
    rate: UPLOADS_PER_SESSION_PER_HOUR,
    period: HOUR,
  },
  uploadGlobal: {
    kind: "token bucket",
    rate: UPLOADS_GLOBAL_PER_HOUR,
    period: HOUR,
  },
});

export const BUSY =
  "The demo is busy right now. Try again later, or run your own copy.";

/** Throws a friendly ConvexError (shown in the UI) if a limit is hit. */
export async function limit(
  ctx: MutationCtx,
  kind: "question" | "upload",
  sessionId: string,
) {
  const mine = await rateLimiter.limit(ctx, `${kind}PerSession`, {
    key: sessionId,
  });
  if (!mine.ok) {
    const minutes = Math.ceil(mine.retryAfter / 60_000);
    throw new ConvexError(
      `You've hit the demo limit. Try again in ${minutes} min, or run your own copy.`,
    );
  }
  const everyone = await rateLimiter.limit(ctx, `${kind}Global`);
  if (!everyone.ok) throw new ConvexError(BUSY);
}
