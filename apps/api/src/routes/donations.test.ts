import { describe, expect, test } from "bun:test";
import {
  campaignCategories,
  campaigners,
  campaigns,
  db,
  donations,
  idempotencyKeys,
  payments,
} from "@galangdana/db";
import { eq } from "drizzle-orm";
import { donationsRoute } from "./donations";

const app = donationsRoute;

async function seedTestCampaign() {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category -- run db:seed first");
  const [existingCampaigner] = await db.select().from(campaigners).limit(1);
  if (!existingCampaigner) throw new Error("no seeded campaigner -- run db:seed first");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `test-checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Test Checkout Campaign",
      shortDescription: "Test",
      story: "Test",
      categoryId: category.id,
      campaignerId: existingCampaigner.id,
      type: "donation",
      currency: "IDR",
      model: "goal",
      goalAmount: 10000000n,
      status: "active",
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  return campaign;
}

describe("POST /donations", () => {
  test("creates a pending donation and a payment with a VA number, for a guest", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "50000" }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { donationId: string; vaNumber: string };
    expect(body.vaNumber).toMatch(/^\d+$/);
    const [donation] = await db.select().from(donations).where(eq(donations.id, body.donationId));
    expect(donation?.status).toBe("pending");
    expect(donation?.userId).toBeNull();
    expect(donation?.amount).toBe(50000n);
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.donationId, body.donationId));
    expect(payment?.vaNumber).toBe(body.vaNumber);
  });

  test("400s without an Idempotency-Key header", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "50000" }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("a repeated Idempotency-Key returns the same donation, not a new one", async () => {
    const campaign = await seedTestCampaign();
    const key = crypto.randomUUID();
    const req = () =>
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "75000" }),
      });
    const first = await app.handle(req());
    const firstBody = (await first.json()) as { donationId: string };
    const second = await app.handle(req());
    const secondBody = (await second.json()) as { donationId: string };
    expect(secondBody.donationId).toBe(firstBody.donationId);
    const rows = await db.select().from(donations).where(eq(donations.id, firstBody.donationId));
    expect(rows).toHaveLength(1);
  });

  test("404s for a nonexistent campaign", async () => {
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: "00000000-0000-0000-0000-000000000000",
          amountStr: "50000",
        }),
      }),
    );
    expect(resp.status).toBe(404);
  });

  test("422s on a non-numeric amountStr", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "not-a-number" }),
      }),
    );
    expect(resp.status).toBe(422);
  });

  test("409s when a donation is already in progress for this idempotency key (simulates a concurrent double-submit)", async () => {
    const campaign = await seedTestCampaign();
    const key = crypto.randomUUID();
    // Simulate another in-flight request having already claimed this key
    // (real concurrent requests would both reach this state via the route's
    // own INSERT ... ON CONFLICT DO NOTHING -- this directly seeds the same
    // DB state without needing genuine thread-level concurrency in a test).
    await db.insert(idempotencyKeys).values({ key, endpoint: "POST /donations", responseBody: {} });
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "50000" }),
      }),
    );
    expect(resp.status).toBe(409);
    const rows = await db.select().from(donations).where(eq(donations.campaignId, campaign.id));
    expect(rows).toHaveLength(0); // no donation was created despite the claimed key
  });
});
