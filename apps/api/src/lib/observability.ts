import * as Sentry from "@sentry/bun";
import { type AnyElysia, Elysia } from "elysia";

let active = false;

// GlitchTip reads the DSN key only from a `sentry_key`/`glitchtip_key`
// query param, a Bearer token, or an X-Sentry-Auth header -- never from the
// envelope body (verified in its event_ingest/authentication.py). But
// @sentry/bun v10 sends auth ONLY inside the envelope (verified by sniffing
// its actual POST: no auth header at all), so stock envelopes 403 with
// {"detail":"Denied"}. The documented `tunnel` option fixes it: the SDK
// POSTs the identical envelope to our tunnel URL, which carries the key as
// a query param. Returns null when the DSN is unparseable (fail-closed init).
export function tunnelUrlForDsn(dsn: string): string | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!key || !projectId) return null;
    return `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${key}`;
  } catch {
    return null;
  }
}

// Sentry init is a no-op unless SENTRY_DSN is set: local dev, CI, and tests
// run without it and behave exactly as before (console logging only).
// Returns whether reporting is active so boot can log the mode once.
export function initObservability(env: Record<string, string | undefined> = process.env): boolean {
  const dsn = env.SENTRY_DSN;
  // Declares state, not just enables it: calling with no DSN deactivates.
  // init runs once at boot in production, but tests share one process with
  // suites that import the real app (whose own import already initialized
  // reporting from ambient env) -- without this, this module's tests would
  // pass or fail depending on file execution order.
  if (!dsn) {
    active = false;
    return false;
  }
  const tunnel = tunnelUrlForDsn(dsn);
  Sentry.init(tunnel ? { dsn, tunnel, tracesSampleRate: 0 } : { dsn, tracesSampleRate: 0 });
  active = true;
  return true;
}

export function isObservabilityActive(): boolean {
  return active;
}

// Forwards to Sentry when active, otherwise a safe no-op. Callers keep
// their existing console logging; this only adds the remote report.
export function captureApiError(err: unknown, context?: Record<string, unknown>): void {
  if (!active) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

function logLine(request: Request, status: unknown, startedAt: WeakMap<Request, number>): void {
  const start = startedAt.get(request) ?? Date.now();
  startedAt.delete(request);
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      method: request.method,
      path: url.pathname,
      status: typeof status === "number" ? status : 500,
      ms: Date.now() - start,
    }),
  );
}

// One JSON line per request on stdout (journald keeps it). NOTE: this must
// wrap the SAME instance that holds the routes
// (withRequestLogging(new Elysia())), not be mounted as a `.use()` plugin --
// verified empirically against elysia@1.1.26 that a plugin's onAfterHandle /
// onAfterResponse / mapResponse never fire for routes registered on the host
// app (only onRequest crosses the plugin boundary). Same reason
// response-mapper wraps rather than mounts.
export function withRequestLogging<T extends AnyElysia>(instance: T): T {
  const startedAt = new WeakMap<Request, number>();
  return instance
    .onRequest(({ request }) => {
      startedAt.set(request, Date.now());
    })
    .onAfterHandle(({ request, set }) => {
      logLine(request, set.status, startedAt);
    })
    .onError(({ request, error, set }) => {
      const errorStatus = (error as { status?: unknown }).status;
      logLine(
        request,
        typeof errorStatus === "number" && errorStatus >= 400 && errorStatus <= 599
          ? errorStatus
          : set.status,
        startedAt,
      );
      return undefined;
    }) as T;
}
