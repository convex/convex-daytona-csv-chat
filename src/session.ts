import { ConvexError } from "convex/values";
import { useState } from "react";

/** A random id per browser. Rate limits and data are scoped to it. */
export function getSessionId() {
  let id = localStorage.getItem("sessionId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("sessionId", id);
  }
  return id;
}

/** useState that survives a refresh, so a half-finished answer is still there. */
export function useStoredState(key: string) {
  const [value, setValue] = useState(() => localStorage.getItem(key));
  const set = (next: string | null) => {
    if (next === null) localStorage.removeItem(key);
    else localStorage.setItem(key, next);
    setValue(next);
  };
  return [value, set] as const;
}

/** ConvexErrors carry friendly messages (rate limits, bad files). */
export function errorText(error: unknown) {
  return error instanceof ConvexError
    ? String(error.data)
    : "Something went wrong. Please try again.";
}
