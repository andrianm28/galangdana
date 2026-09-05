import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  campaignCategories,
  campaigners,
  campaigns,
  db,
  donations,
  idempotencyKeys,
  notificationsOutbox,
  paymentEvents,
  payments,
  sessions,
  users,
} from "@galangdana/db";
import { MockPaymentProvider } from "@galangdana/payments";
import { eq, inArray } from "drizzle-orm";
import { donationsRoute } from "./donations";

const app = donationsRoute;

const TEST_USER_ID = "44444444-5555-6666-7777-999999999901";
const OTHER_USER_ID = "44444444-5555-6666-7777-999999999902";
const TEST_TOKEN = "donations-test-token";
const OTHER_TOKEN = "donations-other-token";

beforeAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.delete(users).where(eq(users.id, OTHER_USER_ID));
  await db.insert(users).values([
    { id: TEST_USER_ID, phone: "+6281199990401" },
    { id: OTHER_USER_ID, phone: "+6281199990402" },
  ]);
  await db.insert(sessions).values([
    { id: TEST_TOKEN, userId: TEST_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: OTHER_TOKEN, userId: OTHER_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  ]);
});

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { ...init.headers, cookie: `session=${token}` },
  });
}

// Every campaign this creates is tracked here and deleted in `afterAll`,
// along with any donations/payments created against it -- previously this
// leaked a real "active" campaign per call (15 call sites, so 15 per test
// run) with no cleanup at all, and with no publishedAt/expiresAt set. Under
// Postgres's default NULLS FIRST for a DESC ORDER BY, those null-publishedAt
// rows sorted to the front of GET /campaigns's default and "newest" listings
// and (being a "goal" model with no expiresAt) broke campaigns.test.ts's
// sort=urgent assertion too -- see the campaigns-test-isolation-gap memory
// this was tracked under. Fixed at the source (a realistic fixture) rather
// than by making campaigns.test.ts's assertions defensive, since a real
// active campaign genuinely should have a real publishedAt.
const campaignIds: string[] = [];

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
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  campaignIds.push(campaign.id);
  return campaign;
}

afterAll(async () => {
  if (campaignIds.length === 0) return;
  const campaignDonations = await db
    .select({ id: donations.id })
    .from(donations)
    .where(inArray(donations.campaignId, campaignIds));
  const donationIds = campaignDonations.map((d) => d.id);
  if (donationIds.length > 0) {
    await db.delete(payments).where(inArray(payments.donationId, donationIds));
    await db.delete(donations).where(inArray(donations.id, donationIds));
  }
  await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
});

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

  test("two genuinely concurrent requests with the same new idempotency key produce exactly one donation", async () => {
    const campaign = await seedTestCampaign();
    const key = crypto.randomUUID();
    const req = () =>
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "50000" }),
      });
    const [a, b] = await Promise.all([app.handle(req()), app.handle(req())]);
    // Whichever request loses the race for the DB-level claim can observe
    // one of two valid states depending on exact timing (both are correct
    // idempotent behavior, and which one happens is a legitimate race, not
    // a bug -- e.g. it depends on the local connection pool's warm state):
    // either it arrives before the winner has finished (409, genuinely
    // in-flight) or after (200, replaying the winner's now-completed
    // response). What must ALWAYS hold, regardless of that timing, is the
    // real guarantee this test exists to prove: only one donation is ever
    // created, and both responses describe that same donation.
    expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
    const rows = await db.select().from(donations).where(eq(donations.campaignId, campaign.id));
    expect(rows).toHaveLength(1);
    const [onlyDonation] = rows;
    if (!onlyDonation) throw new Error("expected exactly one donation row");
    for (const resp of [a, b]) {
      if (resp.status === 200) {
        const body = (await resp.json()) as { donationId: string };
        expect(body.donationId).toBe(onlyDonation.id);
      } else {
        const body = (await resp.json()) as { error: string };
        expect(body.error).toBe("request_in_progress");
      }
    }
  });

  test("a failed request (bad campaign id) releases the idempotency key so a retry with the same key can succeed", async () => {
    const key = crypto.randomUUID();
    const badResp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({
          campaignId: "00000000-0000-0000-0000-000000000000",
          amountStr: "50000",
        }),
      }),
    );
    expect(badResp.status).toBe(404);

    const campaign = await seedTestCampaign();
    const retryResp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "50000" }),
      }),
    );
    expect(retryResp.status).toBe(200);
  });
});

describe("GET /donations/:id", () => {
  test("returns a guest donation's status by id, no auth required", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "20000" }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };

    const statusResp = await app.handle(new Request(`http://localhost/donations/${donationId}`));
    expect(statusResp.status).toBe(200);
    const body = (await statusResp.json()) as {
      id: string;
      status: string;
      vaNumber: string | null;
    };
    expect(body.id).toBe(donationId);
    expect(body.status).toBe("pending");
    expect(body.vaNumber).not.toBeNull();
  });

  test("404s for a nonexistent donation id", async () => {
    const resp = await app.handle(
      new Request("http://localhost/donations/00000000-0000-0000-0000-000000000000"),
    );
    expect(resp.status).toBe(404);
  });

  test("returns a user-owned donation's status when accessed by the owner", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      authedRequest("http://localhost/donations", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "30000" }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };

    const statusResp = await app.handle(
      authedRequest(`http://localhost/donations/${donationId}`, TEST_TOKEN),
    );
    expect(statusResp.status).toBe(200);
    const body = (await statusResp.json()) as {
      id: string;
      status: string;
      vaNumber: string | null;
    };
    expect(body.id).toBe(donationId);
    expect(body.status).toBe("pending");
    expect(body.vaNumber).not.toBeNull();
  });

  test("404s when a different user tries to access a user-owned donation (not 403)", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      authedRequest("http://localhost/donations", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "40000" }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };

    const statusResp = await app.handle(
      authedRequest(`http://localhost/donations/${donationId}`, OTHER_TOKEN),
    );
    expect(statusResp.status).toBe(404);
  });
});

describe("POST /payments/webhook", () => {
  async function createTestDonation(amountStr: string) {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr }),
      }),
    );
    const body = (await resp.json()) as { donationId: string; vaNumber: string };
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.donationId, body.donationId));
    if (!payment) throw new Error("payment row missing");
    return { campaign, donationId: body.donationId, providerOrderId: payment.providerOrderId };
  }

  test("a valid webhook marks the donation paid and increments campaign totals", async () => {
    const { campaign, donationId, providerOrderId } = await createTestDonation("50000");
    const provider = new MockPaymentProvider({
      serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev",
    });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 50000n);

    const [campaignBefore] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));

    const resp = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(resp.status).toBe(200);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("paid");
    expect(donation?.paidAt).not.toBeNull();

    const [campaignAfter] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignAfter?.collectedAmount).toBe((campaignBefore?.collectedAmount ?? 0n) + 50000n);
    expect(campaignAfter?.donationCount).toBe((campaignBefore?.donationCount ?? 0) + 1);
  });

  test("a duplicate webhook delivery is a 200 no-op, not a double-processed donation", async () => {
    const { campaign, donationId, providerOrderId } = await createTestDonation("30000");
    const provider = new MockPaymentProvider({
      serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev",
    });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 30000n);

    const first = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(first.status).toBe(200);
    const [campaignAfterFirst] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));

    // Same exact payload delivered again (a real provider's documented retry behavior).
    const second = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(second.status).toBe(200);

    const [campaignAfterSecond] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    expect(campaignAfterSecond?.collectedAmount).toBe(campaignAfterFirst?.collectedAmount);
    expect(campaignAfterSecond?.donationCount).toBe(campaignAfterFirst?.donationCount);
    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("paid"); // still paid, not re-processed into some other state
  });

  test("a bad signature is rejected with 401 and never touches the donation", async () => {
    const { donationId, providerOrderId } = await createTestDonation("40000");
    const provider = new MockPaymentProvider({ serverKey: "wrong-key-entirely" });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 40000n);

    const resp = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(resp.status).toBe(401);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("pending");
  });

  test("enqueues one notifications_outbox row on a successful paid transition", async () => {
    const { donationId, providerOrderId } = await createTestDonation("60000");
    const provider = new MockPaymentProvider({
      serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev",
    });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 60000n);
    await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    const outboxRows = await db
      .select()
      .from(notificationsOutbox)
      .where(eq(notificationsOutbox.template, "donation_receipt"));
    expect(
      outboxRows.some((r) => (r.payload as { donationId?: string }).donationId === donationId),
    ).toBe(true);
  });

  test("an 'expire' webhook transitions a pending donation's status to expired", async () => {
    const { donationId, providerOrderId } = await createTestDonation("35000");
    const provider = new MockPaymentProvider({
      serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev",
    });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 35000n, "expire");

    const resp = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(resp.status).toBe(200);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("expired");
    const [payment] = await db.select().from(payments).where(eq(payments.donationId, donationId));
    expect(payment?.status).toBe("expired");
  });

  test("a delayed 'expire' webhook arriving after the donation is already paid does not regress its status", async () => {
    const { donationId, providerOrderId } = await createTestDonation("45000");
    const provider = new MockPaymentProvider({
      serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev",
    });

    const paidPayload = await provider.simulateWebhookPayload(providerOrderId, 45000n);
    const paidResp = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(paidPayload),
      }),
    );
    expect(paidResp.status).toBe(200);

    // A different transaction_id (simulateWebhookPayload generates a fresh
    // one via Date.now() each call), so this survives the payment_events
    // dedup guard and reaches the status-transition logic.
    const expirePayload = await provider.simulateWebhookPayload(providerOrderId, 45000n, "expire");
    const expireResp = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(expirePayload),
      }),
    );
    expect(expireResp.status).toBe(200);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("paid");
    const [payment] = await db.select().from(payments).where(eq(payments.donationId, donationId));
    expect(payment?.status).toBe("paid");
  });
});
