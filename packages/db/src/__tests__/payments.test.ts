import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { allocationPolicies } from "../schema/allocation-policies";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";
import { donations } from "../schema/donations";
import { paymentEvents } from "../schema/payment-events";
import { payments } from "../schema/payments";
import { users } from "../schema/users";
import { runSeed } from "../seed/run-seed";

beforeAll(async () => {
  await runSeed();
});

describe("payment_events", () => {
  test("provider + providerEventId is unique -- a duplicate insert rejects", async () => {
    const testId = `test-event-dedup-${Date.now()}`;
    await db.delete(paymentEvents).where(eq(paymentEvents.providerEventId, testId));
    await db.insert(paymentEvents).values({
      provider: "mock",
      providerEventId: testId,
      payload: { test: true },
    });
    let errorThrown = false;
    try {
      await db.insert(paymentEvents).values({
        provider: "mock",
        providerEventId: testId,
        payload: { test: true, second: true },
      });
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        errorThrown = true;
      } else {
        throw error;
      }
    }
    expect(errorThrown).toBe(true);
  });
});

describe("payments", () => {
  test("redirectUrl stores hosted checkout link for redirect-based payment methods", async () => {
    const testOrderId = `test-order-redirect-${Date.now()}`;
    await db.delete(payments).where(eq(payments.providerOrderId, testOrderId));

    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found -- run db:seed first");

    const [testUser] = await db
      .insert(users)
      .values({ phone: `+62812${Date.now() % 100000000}` })
      .returning();
    if (!testUser) throw new Error("user insert failed");

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
        slug: `test-payment-campaign-${Date.now()}`,
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
      })
      .returning();
    if (!campaign) throw new Error("campaign insert failed");

    const [policy] = await db
      .select()
      .from(allocationPolicies)
      .where(eq(allocationPolicies.isDefault, true));
    if (!policy) throw new Error("no default allocation policy seeded");

    const [donation] = await db
      .insert(donations)
      .values({
        userId: testUser.id,
        campaignId: campaign.id,
        allocationPolicyId: policy.id,
        amount: 50000n,
        currency: "IDR",
      })
      .returning();
    if (!donation) throw new Error("donation insert failed");

    const redirectUrl = "https://checkout.sumopod.test/pay/abc123";
    const [payment] = await db
      .insert(payments)
      .values({
        donationId: donation.id,
        provider: "sumopod",
        method: "qris_redirect",
        providerOrderId: testOrderId,
        redirectUrl,
        vaNumber: null,
        grossAmount: 50000n,
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();

    expect(payment?.redirectUrl).toBe(redirectUrl);
    expect(payment?.vaNumber).toBeNull();
    expect(payment?.method).toBe("qris_redirect");
    expect(payment?.provider).toBe("sumopod");
  });
});
