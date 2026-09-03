import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignRevisions } from "../schema/campaign-revisions";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";

async function seedCampaign(slug: string) {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found -- run db seed first");
  const [campaigner] = await db
    .insert(campaigners)
    .values({ type: "individual", displayName: "Test Campaigner" })
    .returning();
  if (!campaigner) throw new Error("campaigner insert failed");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug,
      title: "Test Campaign",
      shortDescription: "desc",
      categoryId: category.id,
      campaignerId: campaigner.id,
      model: "goal",
      goalAmount: 1000000n,
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  return campaign;
}

describe("campaign_revisions", () => {
  beforeAll(async () => {
    await db.delete(campaigns).where(eq(campaigns.slug, "test-campaign-revisions"));
    await db.delete(campaigns).where(eq(campaigns.slug, "test-campaign-revisions-cascade"));
  });

  test("a revision request is created open, with a required note", async () => {
    const campaign = await seedCampaign("test-campaign-revisions");
    const [revision] = await db
      .insert(campaignRevisions)
      .values({ campaignId: campaign.id, field: "cerita", note: "Cerita terlalu singkat." })
      .returning();
    expect(revision?.status).toBe("open");
    expect(revision?.resolvedAt).toBeNull();
    expect(revision?.note).toBe("Cerita terlalu singkat.");
  });

  test("revisions are deleted when their campaign is deleted (cascade)", async () => {
    const campaign = await seedCampaign("test-campaign-revisions-cascade");
    await db
      .insert(campaignRevisions)
      .values({ campaignId: campaign.id, field: "target_donasi", note: "Perlu penjelasan." });
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
    const remaining = await db
      .select()
      .from(campaignRevisions)
      .where(eq(campaignRevisions.campaignId, campaign.id));
    expect(remaining).toHaveLength(0);
  });
});
