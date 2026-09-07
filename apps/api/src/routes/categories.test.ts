import { describe, expect, test } from "bun:test";
import { app } from "../index";

describe("GET /categories", () => {
  test("returns only active categories, excluding archived zakat/wakaf categories", async () => {
    const resp = await app.handle(new Request("http://localhost/categories"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { categories: Array<{ id: number; slug: string }> };
    expect(body.categories.length).toBe(13);
    expect(body.categories.some((c) => c.slug === "bencana-alam")).toBe(true);

    const archivedSlugs = ["zakat", "wakaf", "masjid-berdaya", "wakafproduktif"];
    for (const slug of archivedSlugs) {
      expect(body.categories.some((c) => c.slug === slug)).toBe(false);
    }
  });
});
