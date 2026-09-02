import { describe, expect, test } from "bun:test";
import { app } from "../index";

describe("GET /categories", () => {
  test("returns all seeded categories", async () => {
    const resp = await app.handle(new Request("http://localhost/categories"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { categories: Array<{ id: number; slug: string }> };
    expect(body.categories.length).toBe(17);
    expect(body.categories.some((c) => c.slug === "bencana-alam")).toBe(true);
  });
});
