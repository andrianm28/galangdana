import { afterEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
  captureApiError,
  initObservability,
  isObservabilityActive,
  tunnelUrlForDsn,
  withRequestLogging,
} from "./observability";

const realLog = console.log;
let lines: string[] = [];

afterEach(() => {
  console.log = realLog;
  lines = [];
});

function captureLogs() {
  lines = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
}

interface LogEntry {
  method: string;
  path: string;
  status: number;
  ms: number;
}

function lastEntry(): LogEntry {
  return JSON.parse(lines[0] as string) as LogEntry;
}

describe("observability without DSN", () => {
  test("init reports inactive and capture is a safe no-op", () => {
    captureLogs();
    expect(initObservability({})).toBe(false);
    expect(isObservabilityActive()).toBe(false);
    expect(() => captureApiError(new Error("boom"), { route: "test" })).not.toThrow();
  });
});

describe("tunnelUrlForDsn", () => {
  test("moves the key into a sentry_key query param on the envelope endpoint", () => {
    expect(tunnelUrlForDsn("http://abc123@127.0.0.1:8080/1")).toBe(
      "http://127.0.0.1:8080/api/1/envelope/?sentry_key=abc123",
    );
  });

  test("returns null for garbage instead of building a bad URL", () => {
    expect(tunnelUrlForDsn("not-a-dsn")).toBeNull();
    expect(tunnelUrlForDsn("")).toBeNull();
  });
});

describe("withRequestLogging", () => {
  test("logs one JSON line per request with method, path, and status", async () => {
    captureLogs();
    const app = withRequestLogging(new Elysia()).get("/ping", () => "pong");
    const resp = await app.handle(new Request("http://localhost/ping"));
    expect(resp.status).toBe(200);
    expect(lines.length).toBe(1);
    const entry = lastEntry();
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/ping");
    expect(entry.status).toBe(200);
    expect(typeof entry.ms).toBe("number");
  });

  test("logs error responses with their real status", async () => {
    captureLogs();
    const app = withRequestLogging(new Elysia()).get("/boom", ({ set }) => {
      set.status = 500;
      return { error: "internal_error" };
    });
    await app.handle(new Request("http://localhost/boom"));
    const entry = lastEntry();
    expect(entry.status).toBe(500);
  });

  test("logs thrown errors instead of dropping them", async () => {
    captureLogs();
    const app = withRequestLogging(new Elysia()).get("/throw", () => {
      throw new Error("kaboom");
    });
    await app.handle(new Request("http://localhost/throw"));
    expect(lines.length).toBe(1);
    expect(lastEntry()).toMatchObject({ method: "GET", path: "/throw" });
  });

  test("composes with the response mapper: safe body AND log line", async () => {
    // Guards the wrap order in index.ts: the mapper's onError ends the
    // pipeline, so the logger must be registered before it or error
    // requests go unlogged (observed live: zero lines before the swap).
    const { withApiResponseMapping } = await import("../response-mapper");
    captureLogs();
    const app = withApiResponseMapping(withRequestLogging(new Elysia())).get("/throw", () => {
      throw new Error("kaboom");
    });
    const resp = await app.handle(new Request("http://localhost/throw"));
    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "internal_error" });
    expect(lines.length).toBe(1);
    expect(lastEntry()).toMatchObject({ method: "GET", path: "/throw", status: 500 });
  });
});
