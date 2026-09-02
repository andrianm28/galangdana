import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignDocuments } from "../schema/campaign-documents";
import { campaignDrafts } from "../schema/campaign-drafts";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";
import { users } from "../schema/users";

const TEST_USER_ID = "11111111-2222-3333-4444-555555555503";
const TEST_PHONE = "+6281199990003";

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

beforeAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({ id: TEST_USER_ID, phone: TEST_PHONE });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID)); // cascades
});

describe("campaignDocuments", () => {
  beforeAll(async () => {
    await db.delete(campaigns).where(eq(campaigns.slug, "test-campaign-documents-campaign-scoped"));
    await db
      .delete(campaigns)
      .where(eq(campaigns.slug, "test-campaign-documents-exactly-one-owner"));
  });

  test("stores multiple documents of different types for the same draft", async () => {
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found — run db:seed first");
    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: TEST_USER_ID,
        track: "medical",
        categoryId: category.id,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");

    await db.insert(campaignDocuments).values([
      {
        draftId: draft.id,
        type: "riwayat_medis",
        objectKey: `drafts/${draft.id}/riwayat_medis/history.pdf`,
      },
      {
        draftId: draft.id,
        type: "tagihan_rumah_sakit",
        objectKey: `drafts/${draft.id}/tagihan_rumah_sakit/bill.pdf`,
      },
    ]);

    const rows = await db
      .select()
      .from(campaignDocuments)
      .where(eq(campaignDocuments.draftId, draft.id));
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.type).sort()).toEqual(["riwayat_medis", "tagihan_rumah_sakit"]);

    await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));
  });

  test("a document can belong to a campaign instead of a draft (revision re-upload)", async () => {
    const campaign = await seedCampaign("test-campaign-documents-campaign-scoped");
    const [document] = await db
      .insert(campaignDocuments)
      .values({
        campaignId: campaign.id,
        type: "media_sosial",
        objectKey: "campaigns/x/documents/media_sosial/y.jpg",
      })
      .returning();
    expect(document?.draftId).toBeNull();
    expect(document?.campaignId).toBe(campaign.id);
  });

  test("a document row must have exactly one owner (draft xor campaign)", async () => {
    const campaign = await seedCampaign("test-campaign-documents-exactly-one-owner");
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found — run db:seed first");
    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: TEST_USER_ID,
        track: "medical",
        categoryId: category.id,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");

    // Both campaignId and draftId set should fail
    await expect(
      Promise.resolve(
        db.insert(campaignDocuments).values({
          campaignId: campaign.id,
          draftId: draft.id,
          type: "media_sosial",
          objectKey: "campaigns/x/documents/media_sosial/z.jpg",
        }),
      ),
    ).rejects.toThrow();

    // Neither campaignId nor draftId set should fail
    await expect(
      Promise.resolve(
        db.insert(campaignDocuments).values({
          type: "media_sosial",
          objectKey: "campaigns/x/documents/media_sosial/w.jpg",
        }),
      ),
    ).rejects.toThrow();

    await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));
  });
});
