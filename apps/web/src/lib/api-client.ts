import { treaty } from "@elysiajs/eden";
import type { App } from "@galangdana/api";

const API_URL = process.env.PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Typed against the live Elysia `App` type from apps/api — renaming or
 * removing a route there is a compile error here, not a silent 404 at
 * runtime.
 */
export const api = treaty<App>(API_URL);
