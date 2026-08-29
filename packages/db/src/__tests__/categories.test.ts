import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { runSeed } from "../seed/run-seed";

describe("campaign_categories", () => {
  test("seeding inserts exactly 17 categories", async () => {
    await runSeed();
    const rows = await db.select().from(campaignCategories);
    expect(rows.length).toBe(17);
  });

  test("zakat category has the verified slug and id", async () => {
    const [zakat] = await db
      .select()
      .from(campaignCategories)
      .where(eq(campaignCategories.slug, "zakat"));
    expect(zakat?.id).toBe(27);
    expect(zakat?.title).toBe("Zakat");
  });

  test("seeding is idempotent (re-running does not duplicate rows)", async () => {
    await runSeed();
    const rows = await db.select().from(campaignCategories);
    expect(rows.length).toBe(17);
  });
});
