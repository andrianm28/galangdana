import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";

// Same persistent-local-Postgres idempotency concern established in every
// earlier phase's tests: delete fixture rows by their fixed values first.
const TEST_NAMES = [
  "Test Campaigner Individual",
  "Test Campaigner Yayasan",
  "Test Campaigner Platform",
];

describe("campaigners", () => {
  beforeAll(async () => {
    await db.delete(campaigners).where(inArray(campaigners.displayName, TEST_NAMES));
  });

  test("a campaigner can be created with each type", async () => {
    const [individual] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test Campaigner Individual" })
      .returning();
    const [yayasan] = await db
      .insert(campaigners)
      .values({ type: "yayasan", displayName: "Test Campaigner Yayasan" })
      .returning();
    const [platform] = await db
      .insert(campaigners)
      .values({ type: "platform", displayName: "Test Campaigner Platform" })
      .returning();

    expect(individual?.type).toBe("individual");
    expect(yayasan?.type).toBe("yayasan");
    expect(platform?.type).toBe("platform");
    expect(individual?.verifiedAt).toBeNull();
  });

  test("a campaign requires a valid campaignerId -- inserting with a nonexistent one fails", async () => {
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("expected campaign_categories to already be seeded");

    // Wrapped in Promise.resolve(): drizzle's query builder is thenable but
    // not `instanceof Promise`, and bun:test's `.rejects` matcher requires a
    // native Promise (see the same workaround/comment in campaigns.test.ts).
    await expect(
      Promise.resolve(
        db.insert(campaigns).values({
          slug: "test-campaigners-fk-violation",
          title: "FK violation test",
          shortDescription: "should not insert",
          categoryId: category.id,
          campaignerId: "00000000-0000-0000-0000-000000000000",
          model: "program",
        }),
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
