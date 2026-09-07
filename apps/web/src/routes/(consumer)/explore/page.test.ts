import { describe, expect, test, vi } from "vitest";

describe("explore index page load", () => {
  test("fetches the category list and passes it to the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/categories")) {
          return new Response(
            JSON.stringify({
              categories: [{ id: 1, slug: "bencana-alam", title: "Bencana Alam" }],
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect((result as { categories: unknown }).categories).toEqual([
      { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
    ]);
  });

  // Eden Treaty's returned `error` only covers HTTP-level failures -- a
  // transport failure (API process down, DNS, connection refused) throws
  // instead. Without a try/catch around the load, that throw would become a
  // 500 error page, which the brief explicitly ruled out in favor of
  // degrading to an empty category list. Mirrors
  // (consumer)/page.test.ts's "falls back to an empty feed" case.
  test("falls back to an empty category list, without throwing, when the API connection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      }),
    );

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect((result as { categories: unknown }).categories).toEqual([]);
  });
});
