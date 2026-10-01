import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The public demo starts fresh twice a day: sandboxes, chats and files.
crons.interval("reset demo", { hours: 12 }, internal.reset.resetDemo, {});

export default crons;
