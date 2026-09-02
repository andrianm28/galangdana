import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { campaignDrafts } from "../schema/campaign-drafts";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";
import { individualVerifications } from "../schema/individual-verifications";
import { users } from "../schema/users";

describe("individual_verifications", () => {
  let categoryId: number;

  beforeAll(async () => {
    const [category] = await db
      .select({ id: campaignCategories.id })
      .from(campaignCategories)
      .limit(1);
    if (!category) throw new Error("expected seeded categories for this test");
    categoryId = category.id;
  });

  test("stores identity + contact + document keys for a campaign, one row per campaign", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62812${Date.now()}` })
      .returning();
    if (!user) throw new Error("user insert failed");

    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: user.id,
        track: "medical",
        categoryId,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");

    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test Campaigner", userId: user.id })
      .returning();
    if (!campaigner) throw new Error("campaigner insert failed");

    const [campaign] = await db
      .insert(campaigns)
      .values({
        slug: `test-campaign-${Date.now()}`,
        title: "Bantu Aldi Sembuh",
        shortDescription: "Biaya operasi jantung",
        categoryId,
        campaignerId: campaigner.id,
        model: "goal",
        goalAmount: 15000000n,
        draftId: draft.id,
      })
      .returning();
    if (!campaign) throw new Error("campaign insert failed");

    const [verification] = await db
      .insert(individualVerifications)
      .values({
        campaignId: campaign.id,
        fullName: "Aldi Setiawan",
        nationalId: "3271234567890001",
        dateOfBirth: "1990-05-12",
        address: "Jl. Merdeka No. 1",
        city: "Bandung",
        postalCode: "40111",
      })
      .returning();
    if (!verification) throw new Error("verification insert failed");

    expect(verification.status).toBe("pending");
    expect(verification.ktpObjectKey).toBeNull();
    expect(verification.selfieObjectKey).toBeNull();

    const [fetched] = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(fetched?.fullName).toBe("Aldi Setiawan");

    // unique(campaignId): a second insert for the same campaign conflicts
    await expect(
      Promise.resolve(
        db.insert(individualVerifications).values({
          campaignId: campaign.id,
          fullName: "Duplicate Attempt",
          nationalId: "0000000000000000",
          dateOfBirth: "2000-01-01",
          address: "x",
          city: "x",
          postalCode: "00000",
        }),
      ),
    ).rejects.toThrow();
  });

  test("campaigns.draftId links back to its originating draft and survives draft deletion as NULL", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62813${Date.now()}` })
      .returning();
    if (!user) throw new Error("user insert failed");

    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: user.id,
        track: "non_medical",
        categoryId,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");

    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Another Campaigner", userId: user.id })
      .returning();
    if (!campaigner) throw new Error("campaigner insert failed");

    const [campaign] = await db
      .insert(campaigns)
      .values({
        slug: `linked-campaign-${Date.now()}`,
        title: "Renovasi Musala",
        shortDescription: "Bantu renovasi musala desa",
        categoryId,
        campaignerId: campaigner.id,
        model: "goal",
        goalAmount: 5000000n,
        draftId: draft.id,
      })
      .returning();
    if (!campaign) throw new Error("campaign insert failed");

    expect(campaign.draftId).toBe(draft.id);

    await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));

    const [afterDelete] = await db
      .select({ draftId: campaigns.draftId })
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    expect(afterDelete?.draftId).toBeNull();
  });

  test("campaigners.userId is unique per user", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62814${Date.now()}` })
      .returning();
    if (!user) throw new Error("user insert failed");

    await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "First", userId: user.id });

    await expect(
      Promise.resolve(
        db
          .insert(campaigners)
          .values({ type: "individual", displayName: "Second", userId: user.id }),
      ),
    ).rejects.toThrow();
  });
});
