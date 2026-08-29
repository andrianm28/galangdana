import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { withApiResponseMapping } from "./response-mapper";

// A throwaway app, built with the exact same withApiResponseMapping() logic
// the real app (index.ts) uses, exercising response-shaping behaviors the
// real /healthz-only route surface has no reason to cover. Sharing the
// helper (rather than re-implementing the mapResponse callback here) means
// these tests can never silently drift from what production actually does.
const testApp = withApiResponseMapping(new Elysia())
  .get("/not-found", ({ set }) => {
    set.status = 404;
    return { error: "not found" };
  })
  .get("/boom", () => {
    throw new Error("boom");
  })
  // The exact error shape the final whole-branch review leaked: a network
  // error carrying its own enumerable errno/syscall/address/port, plus a
  // `code` property that Elysia surfaces as the onError `code` argument
  // (i.e. "ECONNREFUSED", NOT "UNKNOWN" -- verified empirically against
  // Elysia 1.1.26, and the reason the error handler intercepts every code
  // except VALIDATION rather than exempting by code name).
  .get("/leaky", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:1") as Error & Record<string, unknown>;
    err.errno = -111;
    err.syscall = "connect";
    err.address = "127.0.0.1";
    err.port = 1;
    err.code = "ECONNREFUSED";
    throw err;
  })
  .get("/raw", () => new Response("raw body", { status: 201 }))
  // A thrown value fully controls its own `status` property, same as
  // `code` -- an out-of-range value here must not reach
  // `new Response(..., { status })` unclamped, or it throws a RangeError
  // and the error handler itself becomes the failure.
  .get("/bad-status", () => {
    const err = new Error("weird") as Error & Record<string, unknown>;
    err.status = 999;
    throw err;
  });

describe("withApiResponseMapping", () => {
  test("preserves a non-200 status set via set.status", async () => {
    const response = await testApp.handle(new Request("http://localhost/not-found"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });

  test("a thrown error surfaces as a real error status, not 200 with an empty body", async () => {
    const response = await testApp.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    expect(response.status).not.toBe(200);
  });

  test("a thrown error's body is generic, never the raw error's own properties", async () => {
    const response = await testApp.handle(new Request("http://localhost/boom"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "internal_error" });
  });

  test("a thrown network error never leaks errno/syscall/address/port to the client", async () => {
    const response = await testApp.handle(new Request("http://localhost/leaky"));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "internal_error" });
    // Explicit negative assertions on the exact fields the review saw
    // reach a client, so a future regression here fails loudly.
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("errno");
    expect(text).not.toContain("syscall");
    expect(text).not.toContain("127.0.0.1");
  });

  test("an unmatched route still answers 404, with a matching generic body", async () => {
    // Elysia hands NOT_FOUND to onError with `set.status` still 200 and
    // the real 404 only on the error object -- a status derived from
    // `set.status` would turn every 404 into a 500. The body label is a
    // re-labeling of the (already-safe) status, not a code-name
    // exemption, so it stays generic rather than echoing anything about
    // the specific route.
    const response = await testApp.handle(new Request("http://localhost/no-such-route"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("an out-of-range error status is clamped to 500, not passed through raw", async () => {
    const response = await testApp.handle(new Request("http://localhost/bad-status"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
  });

  test("a real Response returned from a handler passes through unchanged", async () => {
    const response = await testApp.handle(new Request("http://localhost/raw"));
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("raw body");
  });
});
