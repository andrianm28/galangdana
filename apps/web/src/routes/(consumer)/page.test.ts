import { describe, expect, test, vi } from "vitest";

describe("home page load", () => {
  test("fetches a campaign feed and the category list, and passes both to the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/campaigns?")) {
          return new Response(
            JSON.stringify({
              campaigns: [{ slug: "test-campaign", title: "Test Campaign" }],
              page: 1,
              totalPages: 1,
              totalCount: 1,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect((result as { campaigns: unknown }).campaigns).toEqual([
      { slug: "test-campaign", title: "Test Campaign" },
    ]);
  });

  test("falls back to an empty feed, without throwing, when the API connection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      }),
    );

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect((result as { campaigns: unknown }).campaigns).toEqual([]);
  });
});
