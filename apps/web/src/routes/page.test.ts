import { describe, expect, test, vi } from "vitest";

describe("home page load", () => {
  test("fetches health status from the API and passes it to the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ status: "ok", service: "api", timestamp: "2026-08-29T00:00:00.000Z" }),
            {
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect(result).toEqual({
      apiStatus: "ok",
      apiService: "api",
    });
  });
});
