import { describe, expect, test } from "bun:test";
import { app } from "../index";

describe("GET /campaigns", () => {
  test("returns a paginated list of active campaigns with money fields as MoneyJSON", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      campaigns: Array<{ collectedAmount: { amount: string; currency: string }; model: string }>;
      page: number;
      totalPages: number;
      totalCount: number;
    };
    expect(body.campaigns.length).toBeGreaterThan(0);
    expect(body.totalCount).toBeGreaterThanOrEqual(8); // this plan's own seed data
    expect(typeof body.campaigns[0]?.collectedAmount.amount).toBe("string");
  });

  test("filters by category slug", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?category=zakat"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { campaigns: Array<{ category: { slug: string } }> };
    expect(body.campaigns.length).toBeGreaterThan(0);
    for (const c of body.campaigns) {
      expect(c.category.slug).toBe("zakat");
    }
  });

  test("sort=newest orders by publishedAt descending", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?sort=newest&limit=50"));
    const body = (await resp.json()) as { campaigns: Array<{ publishedAt: string }> };
    const dates = body.campaigns.map((c) => new Date(c.publishedAt).getTime());
    const sorted = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sorted);
  });

  test("sort=urgent orders goal-model campaigns by soonest deadline first, program campaigns last", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?sort=urgent&limit=50"));
    const body = (await resp.json()) as {
      campaigns: Array<{ model: string; expiresAt: string | null }>;
    };
    const goalCampaigns = body.campaigns.filter((c) => c.model === "goal");
    const deadlines = goalCampaigns.map((c) => new Date(c.expiresAt as string).getTime());
    const sorted = [...deadlines].sort((a, b) => a - b);
    expect(deadlines).toEqual(sorted);

    const lastGoalIndex = body.campaigns.map((c) => c.model).lastIndexOf("goal");
    const firstProgramIndex = body.campaigns.map((c) => c.model).indexOf("program");
    if (firstProgramIndex !== -1) {
      expect(lastGoalIndex).toBeLessThan(firstProgramIndex);
    }
  });

  test("cover image URLs are real, fully-formed imgproxy URLs, not raw object keys", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?limit=1"));
    const body = (await resp.json()) as { campaigns: Array<{ coverImageUrl: string }> };
    expect(body.campaigns[0]?.coverImageUrl).toMatch(/^http:\/\/localhost:8090\//);
    expect(body.campaigns[0]?.coverImageUrl).not.toContain("campaigns/covers/");
  });

  test("pagination: limit and page narrow the result set", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?limit=2&page=1"));
    const body = (await resp.json()) as { campaigns: unknown[]; page: number };
    expect(body.campaigns.length).toBe(2);
    expect(body.page).toBe(1);
  });
});
