import { env } from "$env/dynamic/public";
import { treaty } from "@elysiajs/eden";
import type { App } from "@galangdana/api";

const API_URL = env.PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * A server-side (SSR) authenticated Eden Treaty client, scoped to ONE
 * incoming request's session cookie.
 *
 * This is deliberately NOT the same client instance as $lib/api-client.ts's
 * shared `api` singleton: that one relies on the BROWSER's own cookie jar
 * (`credentials: "include"`), which only exists for client-side requests.
 * A server-side `load` function has no browser cookie jar to opt into --
 * SvelteKit's own server-side `fetch` does not automatically forward an
 * incoming request's cookies to a DIFFERENT origin (apps/api is a
 * different port/origin from apps/web even in local dev) -- so the
 * cookie must be read explicitly (via `event.cookies.get(...)` in the
 * calling `+layout.server.ts`/`+page.server.ts`) and passed in here.
 *
 * Must match apps/api's SESSION_COOKIE constant (apps/api/src/lib/session.ts)
 * -- not imported directly since apps/web and apps/api are separate apps
 * with no established cross-app source import convention in this repo.
 */
export function createServerApiClient(sessionToken: string | undefined) {
  return treaty<App>(API_URL, {
    headers: sessionToken ? { cookie: `session=${sessionToken}` } : undefined,
  });
}
