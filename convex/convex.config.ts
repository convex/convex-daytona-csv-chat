import daytona from "@daytona/convex/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import staticHosting from "@convex-dev/static-hosting/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  // Typed env vars: read them with `import { env } from "./_generated/server"`.
  env: { DAYTONA_API_KEY: v.string() },
  // Static hosting owns "/" so the frontend is served from <deployment>.convex.site.
  httpPrefix: "/api",
});
app.use(daytona);
app.use(rateLimiter);
app.use(staticHosting, { httpPrefix: "/" });

export default app;
