import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";
import { disbursementRequests } from "../schema/disbursement-requests";
import { users } from "../schema/users";

describe("disbursement_requests", () => {
  let userId: string;
  let campaignerId: string;
  let campaignId: string;

  afterAll(async () => {
    if (campaignId) {
      await db.delete(disbursementRequests).where(eq(disbursementRequests.campaignId, campaignId));
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
    if (campaignerId) await db.delete(campaigners).where(eq(campaigners.id, campaignerId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
  });

  test("a row can be created in draft status with nullable fields unset", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62812${Date.now()}` })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    userId = user!.id;
    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test", userId })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    campaignerId = campaigner!.id;
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found -- run db:seed first");
    const [campaign] = await db
      .insert(campaigns)
      .values({
        slug: `test-campaign-${Date.now()}`,
        title: "Test",
        shortDescription: "Test",
        story: "Test",
        model: "goal",
        goalAmount: 1_000_000n,
        status: "active",
        categoryId: category.id,
        campaignerId,
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    campaignId = campaign!.id;

    const [row] = await db.insert(disbursementRequests).values({ campaignId }).returning();

    expect(row?.status).toBe("draft");
    expect(row?.amount).toBeNull();
    expect(row?.bankAccountId).toBeNull();
  });
});
