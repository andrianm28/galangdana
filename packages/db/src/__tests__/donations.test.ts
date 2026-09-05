import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { allocationPolicies } from "../schema/allocation-policies";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";
import { donations } from "../schema/donations";
import { users } from "../schema/users";
import { runSeed } from "../seed/run-seed";

const TEST_PHONE_BASE = "+628119930000";

async function seedTestCampaign() {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found -- run db:seed first");
  const testUser = await ensureTestUser();
  const [campaigner] = await db
    .insert(campaigners)
    .values({
      userId: testUser.id,
      type: "individual",
      displayName: `Test Campaigner ${Date.now()}`,
    })
    .returning();
  if (!campaigner) throw new Error("campaigner insert failed");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `test-donation-campaign-${Date.now()}`,
      title: "Test Campaign",
      shortDescription: "Test",
      story: "Test",
      categoryId: category.id,
      campaignerId: campaigner.id,
      type: "donation",
      currency: "IDR",
      model: "goal",
      goalAmount: 10000000n,
      status: "active",
      // A real active campaign always has these set; a null publishedAt
      // sorts first under GET /campaigns's default DESC ordering
      // (Postgres's NULLS FIRST), which corrupts apps/api's
      // campaigns.test.ts sort assertions whenever this row is still
      // present in the shared test database.
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  return campaign;
}

async function ensureTestUser() {
  const phone = `${TEST_PHONE_BASE}${Date.now() % 10000}`;
  const [user] = await db.insert(users).values({ phone }).returning();
  if (!user) throw new Error("user insert failed");
  return user;
}

beforeAll(async () => {
  await runSeed();
});

describe("donations", () => {
  test("a guest donation can be created with a null userId", async () => {
    const campaign = await seedTestCampaign();
    const [policy] = await db
      .select()
      .from(allocationPolicies)
      .where(eq(allocationPolicies.isDefault, true));
    if (!policy) throw new Error("no default allocation policy seeded");
    const [donation] = await db
      .insert(donations)
      .values({
        campaignId: campaign.id,
        allocationPolicyId: policy.id,
        amount: 50000n,
        currency: "IDR",
      })
      .returning();
    expect(donation?.userId).toBeNull();
    expect(donation?.status).toBe("pending");
    expect(donation?.platformFee).toBe(0n);
  });

  test("a donation attached to a user records userId", async () => {
    const campaign = await seedTestCampaign();
    const user = await ensureTestUser();
    const [policy] = await db
      .select()
      .from(allocationPolicies)
      .where(eq(allocationPolicies.isDefault, true));
    if (!policy) throw new Error("no default allocation policy seeded");
    const [donation] = await db
      .insert(donations)
      .values({
        userId: user.id,
        campaignId: campaign.id,
        allocationPolicyId: policy.id,
        amount: 100000n,
        currency: "IDR",
      })
      .returning();
    expect(donation?.userId).toBe(user.id);
  });
});
