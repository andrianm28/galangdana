import { env } from "$env/dynamic/public";
import { treaty } from "@elysiajs/eden";
import type { App } from "@galangdana/api";

const API_URL = env.PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Typed against the live Elysia `App` type from apps/api — renaming or
 * removing a route there is a compile error here, not a silent 404 at
 * runtime.
 *
 * Uses $env/dynamic/public, not raw process.env: this module is imported
 * by a universal +page.ts load, which runs both server-side (SSR) and
 * client-side (hydration, then every later client-side navigation).
 * Vite's client build silently substitutes process.env with an empty
 * object rather than throwing, so a raw process.env.PUBLIC_API_URL read
 * doesn't crash the browser bundle -- it just always evaluates to
 * undefined there, falling back to localhost regardless of what the
 * server's real PUBLIC_API_URL is. $env/dynamic/public carries the
 * actual value through to the client correctly.
 */
export const api = treaty<App>(API_URL);
