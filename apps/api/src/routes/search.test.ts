import { describe, expect, test } from "bun:test";
import { app } from "../index";

describe("GET /search", () => {
  test("returns campaigns matching a typo-tolerant query, with the full summary shape (not the bare search-index shape)", async () => {
    const resp = await app.handle(new Request("http://localhost/search?q=banjr%20kalimantan")); // deliberate typo
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      results: Array<{ slug: string; coverImageUrl: string; collectedAmount: { amount: string } }>;
      query: string;
    };
    expect(
      body.results.some((r) => r.slug === "bantu-korban-banjir-bandang-kalimantan-selatan"),
    ).toBe(true);
    // Confirms results are re-hydrated to the full CampaignSummary shape
    // (imgproxy URL, MoneyJSON amounts) rather than returning the
    // Meilisearch index's own bare document shape, which has neither.
    expect(body.results[0]?.coverImageUrl).toMatch(/^http:\/\/localhost:8090\//);
  });

  test("returns an empty result set for a query matching nothing, not an error", async () => {
    const resp = await app.handle(new Request("http://localhost/search?q=xyzxyzxyznomatch"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  test("422s on a missing q parameter", async () => {
    const resp = await app.handle(new Request("http://localhost/search"));
    expect(resp.status).toBe(422); // TypeBox validation failure on the required, minLength:1 `q` field
  });
});
