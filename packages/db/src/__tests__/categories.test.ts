import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { runSeed } from "../seed/run-seed";

const ARCHIVED_SLUGS = ["zakat", "wakaf", "masjid-berdaya", "wakafproduktif"];

describe("campaign_categories", () => {
  test("seeding inserts exactly 17 categories, 13 active and 4 archived", async () => {
    await runSeed();
    const rows = await db.select().from(campaignCategories);
    expect(rows.length).toBe(17);
    expect(rows.filter((r) => r.isActive).length).toBe(13);

    const archived = rows.filter((r) => ARCHIVED_SLUGS.includes(r.slug));
    expect(archived.length).toBe(4);
    for (const row of archived) {
      expect(row.isActive).toBe(false);
    }
  });

  // Was "zakat category has the verified slug and id" -- inverted rather than
  // deleted outright when zakat/wakaf were cut from the product: this is a
  // stronger regression guard than removing the test entirely, since it
  // fails loudly if a future change deletes the row (breaking any campaign
  // FK still pointing at it) or silently reactivates it.
  test("zakat category still exists at its verified id, but is archived", async () => {
    const [zakat] = await db
      .select()
      .from(campaignCategories)
      .where(eq(campaignCategories.slug, "zakat"));
    expect(zakat?.id).toBe(27);
    expect(zakat?.title).toBe("Zakat");
    expect(zakat?.isActive).toBe(false);
  });

  test("rumah-ibadah stays active (an ordinary building-fund category, not part of the zakat/wakaf cut)", async () => {
    const [rumahIbadah] = await db
      .select()
      .from(campaignCategories)
      .where(eq(campaignCategories.slug, "rumah-ibadah"));
    expect(rumahIbadah?.id).toBe(23);
    expect(rumahIbadah?.isActive).toBe(true);
  });

  test("seeding is idempotent (re-running does not duplicate rows)", async () => {
    await runSeed();
    const rows = await db.select().from(campaignCategories);
    expect(rows.length).toBe(17);
  });
});
