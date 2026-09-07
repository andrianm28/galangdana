import { describe, expect, test, vi } from "vitest";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function campaignsResponse(sort: string) {
  return jsonResponse({
    campaigns: [{ slug: `${sort}-campaign`, title: `${sort} campaign` }],
    page: 1,
    totalPages: 1,
    totalCount: 1,
  });
}

function categoriesResponse() {
  return jsonResponse({
    categories: [{ id: 1, slug: "bencana-alam", title: "Bencana Alam" }],
  });
}

describe("home page load", () => {
  test("fetches a campaign feed and the category list, and passes both to the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/campaigns?") && url.includes("sort=urgent")) {
          return campaignsResponse("urgent");
        }
        if (url.includes("/campaigns?") && url.includes("sort=newest")) {
          return campaignsResponse("newest");
        }
        if (url.includes("/categories")) {
          return categoriesResponse();
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const { load } = await import("./+page");
    const result = (await load({ fetch: globalThis.fetch } as never)) as {
      urgentCampaigns: unknown;
      latestCampaigns: unknown;
      categories: unknown;
    };

    expect(result.urgentCampaigns).toEqual([{ slug: "urgent-campaign", title: "urgent campaign" }]);
    expect(result.latestCampaigns).toEqual([{ slug: "newest-campaign", title: "newest campaign" }]);
    expect(result.categories).toEqual([{ id: 1, slug: "bencana-alam", title: "Bencana Alam" }]);
  });

  test("falls back to empty feeds and an empty category list, without throwing, when the API connection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      }),
    );

    const { load } = await import("./+page");
    const result = (await load({ fetch: globalThis.fetch } as never)) as {
      urgentCampaigns: unknown;
      latestCampaigns: unknown;
      categories: unknown;
    };

    expect(result.urgentCampaigns).toEqual([]);
    expect(result.latestCampaigns).toEqual([]);
    expect(result.categories).toEqual([]);
  });

  // The whole point of fetching urgent/latest/categories independently: one
  // endpoint returning its declared 404 error shape must not blank the other
  // two sections. Without this test the independent-degradation requirement
  // could regress to a single shared try/catch silently.
  test("one endpoint failing leaves the other two sections populated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/campaigns?") && url.includes("sort=urgent")) {
          return jsonResponse({ error: "category_not_found" }, { status: 404 });
        }
        if (url.includes("/campaigns?") && url.includes("sort=newest")) {
          return campaignsResponse("newest");
        }
        if (url.includes("/categories")) {
          return categoriesResponse();
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const { load } = await import("./+page");
    const result = (await load({ fetch: globalThis.fetch } as never)) as {
      urgentCampaigns: unknown;
      latestCampaigns: unknown;
      categories: unknown;
    };

    expect(result.urgentCampaigns).toEqual([]);
    expect(result.latestCampaigns).toEqual([{ slug: "newest-campaign", title: "newest campaign" }]);
    expect(result.categories).toEqual([{ id: 1, slug: "bencana-alam", title: "Bencana Alam" }]);
  });
});
