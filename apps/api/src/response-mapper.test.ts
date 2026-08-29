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
  .get("/raw", () => new Response("raw body", { status: 201 }));

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

  test("a real Response returned from a handler passes through unchanged", async () => {
    const response = await testApp.handle(new Request("http://localhost/raw"));
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("raw body");
  });
});
