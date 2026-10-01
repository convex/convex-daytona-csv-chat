import { Daytona } from "@daytona/convex";
import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import {
  env,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  APP_NAME,
  BUSY,
  MAX_LIVE_SANDBOXES,
  PYTHON_TIMEOUT_SECONDS,
  SANDBOX_AUTO_DELETE_MINUTES,
  SANDBOX_AUTO_STOP_MINUTES,
} from "./limits";

export const daytona = new Daytona(components.daytona, {
  apiKey: env.DAYTONA_API_KEY,
});

export const CSV_PATH = "/home/daytona/data.csv";
export const CHART_DIR = "/home/daytona/out";

// Matplotlib reads this on startup, so every chart the agent draws matches the
// app's dark theme without the agent writing any styling code.
const MATPLOTLIBRC = `backend: Agg
svg.fonttype: none
figure.figsize: 9, 5
figure.facecolor: 16161d
axes.facecolor: 16161d
savefig.facecolor: 16161d
savefig.bbox: tight
axes.edgecolor: 3f3f46
axes.labelcolor: d4d4d8
axes.titlecolor: fafafa
axes.titlesize: 15
axes.titleweight: bold
axes.labelsize: 12
axes.grid: True
axes.axisbelow: True
axes.spines.top: False
axes.spines.right: False
axes.prop_cycle: cycler('color', ['F3B01C', 'C46BB8', '4FB3BF', 'E8735A', '8BC34A', '9A8CF2'])
grid.color: 2a2a33
text.color: e4e4e7
xtick.color: a1a1aa
ytick.color: a1a1aa
xtick.labelsize: 11
ytick.labelsize: 11
legend.frameon: False
font.family: sans-serif
font.sans-serif: Inter, Helvetica, Arial, DejaVu Sans
`;

/** Refuse to start another sandbox if too many of this app's are live. */
export async function assertSandboxCapacity(ctx: QueryCtx | MutationCtx) {
  // The component records every sandbox it creates and bumps `updatedAt` on
  // every run, so "live" = not stopped/deleted and used since auto-stop.
  const cutoff = Date.now() - SANDBOX_AUTO_STOP_MINUTES * 60_000;
  const sandboxes = await daytona.listSandboxes(ctx, { limit: 100 });
  const live = sandboxes.filter(
    (s) =>
      s.updatedAt > cutoff &&
      !["destroyed", "destroying", "stopped", "archived", "error"].includes(
        s.state,
      ),
  );
  if (live.length >= MAX_LIVE_SANDBOXES) throw new ConvexError(BUSY);
}

/** A fresh sandbox with the CSV and the chart theme written into it. */
export async function createSandbox(
  ctx: ActionCtx,
  args: { sessionId: string; csv: string },
) {
  const { sandboxId } = await daytona.createSandbox(ctx, {
    labels: { app: APP_NAME },
    userKey: args.sessionId,
    autoStopInterval: SANDBOX_AUTO_STOP_MINUTES,
    autoDeleteInterval: SANDBOX_AUTO_DELETE_MINUTES,
  });
  await daytona.run(ctx, {
    sandboxId,
    command: `mkdir -p ${CHART_DIR} /home/daytona/.config/matplotlib`,
  });
  await daytona.writeFile(ctx, { sandboxId, path: CSV_PATH, content: args.csv });
  await daytona.writeFile(ctx, {
    sandboxId,
    path: "/home/daytona/.config/matplotlib/matplotlibrc",
    content: MATPLOTLIBRC,
  });
  return sandboxId;
}

/** True if the sandbox still exists. Stopped is fine: runCode restarts it. */
export async function sandboxExists(ctx: ActionCtx, sandboxId: string) {
  const sandbox = await daytona.refreshSandbox(ctx, { sandboxId });
  return sandbox !== null && !["destroyed", "destroying"].includes(sandbox.state);
}

/**
 * Run one snippet of Python. Errors aren't exceptions here: the traceback is
 * returned as output so the agent can read it and fix its code.
 */
export async function runPython(
  ctx: ActionCtx,
  sandboxId: string,
  code: string,
) {
  try {
    const { exitCode, result } = await daytona.runCode(ctx, {
      sandboxId,
      code,
      language: "python",
      timeoutSeconds: PYTHON_TIMEOUT_SECONDS,
    });
    return { ok: exitCode === 0, output: result };
  } catch (error) {
    return { ok: false, output: `Sandbox error: ${String(error)}` };
  }
}

/**
 * Move any SVG charts the code saved into Convex file storage. Files cross the
 * component boundary as UTF-8 strings, which is why charts are SVG, not PNG.
 */
export async function collectCharts(ctx: ActionCtx, sandboxId: string) {
  const files = await daytona.listFiles(ctx, { sandboxId, path: CHART_DIR });
  const chartIds: Id<"_storage">[] = [];
  for (const file of files.filter((f) => f.name.endsWith(".svg")).slice(0, 3)) {
    const path = `${CHART_DIR}/${file.name}`;
    const svg = await daytona.readFile(ctx, { sandboxId, path });
    await daytona.deleteFile(ctx, { sandboxId, path });
    // The UI renders charts with <img>, which never runs scripts, but there is
    // no reason to store anything that isn't a plain chart.
    if (svg.length > 2_000_000 || /<script|javascript:/i.test(svg)) continue;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    chartIds.push(await ctx.storage.store(blob));
  }
  return chartIds;
}
