import { beforeAll, describe, expect, test } from "bun:test";
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
import { eq } from "drizzle-orm";
import { donationsRoute } from "./donations";

const app = donationsRoute;

// Matches donations.ts's own SUMOPOD_WEBHOOK_SECRET fallback default (no
// SUMOPOD_WEBHOOK_SECRET env var is set for this test run) -- same pattern
// as MOCK_MIDTRANS_SERVER_KEY's "mock-server-key-for-dev" default below.
const SUMOPOD_WEBHOOK_SECRET =
  process.env.SUMOPOD_WEBHOOK_SECRET ?? "whsec_dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz";

// Independently computes a valid svix-style signature -- mirrors
// sumopod-signature.test.ts's and sumopod-provider.test.ts's own local
// helpers rather than importing sumopod-signature.ts's internals.
async function computeSumopodSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
) {
  function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return `v1,${sig}`;
}

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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "50000",
          paymentMethod: "bank_transfer_va",
        }),
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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "50000",
          paymentMethod: "bank_transfer_va",
        }),
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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "75000",
          paymentMethod: "bank_transfer_va",
        }),
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
          paymentMethod: "bank_transfer_va",
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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "not-a-number",
          paymentMethod: "bank_transfer_va",
        }),
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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "50000",
          paymentMethod: "bank_transfer_va",
        }),
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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "50000",
          paymentMethod: "bank_transfer_va",
        }),
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
          paymentMethod: "bank_transfer_va",
        }),
      }),
    );
    expect(badResp.status).toBe(404);

    const campaign = await seedTestCampaign();
    const retryResp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "50000",
          paymentMethod: "bank_transfer_va",
        }),
      }),
    );
    expect(retryResp.status).toBe(200);
  });
});

// Sumopod's `createCharge` always calls its hardcoded sandbox URL
// (https://api-pay-sandbox.sumopod.com) -- there's no local baseUrl override
// wired through donations.ts's getProvider(), and hitting the real sandbox
// from this suite would make tests network-dependent and flaky. Stubbing
// globalThis.fetch is the only way to exercise the real POST /donations ->
// getProvider("qris_redirect") -> SumopodProvider.createCharge path without
// a real network call, while still proving the route wiring (not just an
// isolated `instanceof` check) actually works end-to-end.
async function withStubbedSumopodFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("api-pay-sandbox.sumopod.com")) {
      return Response.json({
        payment_id: `sumopod-test-payment-${crypto.randomUUID()}`,
        order_id: "unused-by-this-fixture",
        payment_link_url: "https://pay.sumopod.com/pay/test-fixture",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function createTestQrisDonation(amountStr: string) {
  const campaign = await seedTestCampaign();
  const resp = await withStubbedSumopodFetch(() =>
    app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr,
          paymentMethod: "qris_redirect",
        }),
      }),
    ),
  );
  const body = (await resp.json()) as { donationId: string };
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.donationId, body.donationId));
  if (!payment) throw new Error("payment row missing");
  return { campaign, donationId: body.donationId, providerOrderId: payment.providerOrderId };
}

describe("POST /donations with paymentMethod: qris_redirect", () => {
  test("creates a pending donation and a payment with a redirect URL, backed by SumopodProvider", async () => {
    const { donationId } = await createTestQrisDonation("70000");

    const body_ = await app.handle(new Request(`http://localhost/donations/${donationId}`)).then(
      (r) =>
        r.json() as Promise<{
          method: string;
          vaNumber: string | null;
          redirectUrl: string | null;
        }>,
    );
    expect(body_.method).toBe("qris_redirect");
    expect(body_.vaNumber).toBeNull();
    expect(body_.redirectUrl).toBe("https://pay.sumopod.com/pay/test-fixture");

    const [payment] = await db.select().from(payments).where(eq(payments.donationId, donationId));
    expect(payment?.provider).toBe("sumopod");
    expect(payment?.method).toBe("qris_redirect");
    expect(payment?.vaNumber).toBeNull();
    expect(payment?.redirectUrl).toBe("https://pay.sumopod.com/pay/test-fixture");
  });
});

describe("GET /donations/:id", () => {
  test("returns a guest donation's status by id, no auth required", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "20000",
          paymentMethod: "bank_transfer_va",
        }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };

    const statusResp = await app.handle(new Request(`http://localhost/donations/${donationId}`));
    expect(statusResp.status).toBe(200);
    const body = (await statusResp.json()) as {
      id: string;
      status: string;
      method: string;
      vaNumber: string | null;
      redirectUrl: string | null;
    };
    expect(body.id).toBe(donationId);
    expect(body.status).toBe("pending");
    expect(body.method).toBe("bank_transfer_va");
    expect(body.vaNumber).not.toBeNull();
    expect(body.redirectUrl).toBeNull();
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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "30000",
          paymentMethod: "bank_transfer_va",
        }),
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
      method: string;
      vaNumber: string | null;
      redirectUrl: string | null;
    };
    expect(body.id).toBe(donationId);
    expect(body.status).toBe("pending");
    expect(body.method).toBe("bank_transfer_va");
    expect(body.vaNumber).not.toBeNull();
    expect(body.redirectUrl).toBeNull();
  });

  test("404s when a different user tries to access a user-owned donation (not 403)", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      authedRequest("http://localhost/donations", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "40000",
          paymentMethod: "bank_transfer_va",
        }),
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
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr,
          paymentMethod: "bank_transfer_va",
        }),
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

    // payment_events.provider must record which provider actually delivered
    // this event, not a hardcoded literal -- this route processes both
    // /payments/webhook (mock) and /payments/webhook/sumopod deliveries
    // through the same shared function.
    const [eventRow] = await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.providerEventId, payload.transaction_id as string));
    expect(eventRow?.provider).toBe("mock");
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

describe("POST /payments/webhook/sumopod", () => {
  test("an invalid signature is rejected with 401 and never writes a payment_events row", async () => {
    const rawBody = JSON.stringify({
      event_type: "payment.completed",
      data: { payment_id: "sumopod-invalid-sig-test", order_id: "irrelevant", status: "completed" },
    });
    const resp = await app.handle(
      new Request("http://localhost/payments/webhook/sumopod", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": "msg_invalid_sig_test",
          "svix-timestamp": "1700000000",
          "svix-signature": "v1,bm90LXRoZS1yaWdodC1zaWduYXR1cmU=",
        },
        body: rawBody,
      }),
    );
    expect(resp.status).toBe(401);

    const rows = await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.providerEventId, "sumopod-invalid-sig-test:payment.completed"));
    expect(rows).toHaveLength(0);
  });

  test("a validly-signed payment.completed webhook marks a qris_redirect donation paid, increments campaign totals, and records provider: sumopod", async () => {
    const { campaign, donationId, providerOrderId } = await createTestQrisDonation("80000");

    // Sumopod's own internal payment id -- deliberately a DIFFERENT value
    // than providerOrderId (which, per this same task's fix to
    // sumopod-provider.ts, is our own order id / donationId), so this test
    // proves the two sides correlate via order_id, not by coincidence.
    const sumopodPaymentId = `sumopod-internal-payment-${crypto.randomUUID()}`;
    const rawBody = JSON.stringify({
      event_type: "payment.completed",
      data: {
        payment_id: sumopodPaymentId,
        order_id: providerOrderId,
        amount: 80000,
        fee: 1200,
        net_amount: 78800,
        status: "completed",
        payment_method: "qris",
        completed_at: new Date().toISOString(),
      },
    });
    const svixId = `msg_${crypto.randomUUID()}`;
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const sig = await computeSumopodSignature(
      SUMOPOD_WEBHOOK_SECRET,
      svixId,
      svixTimestamp,
      rawBody,
    );

    const [campaignBefore] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));

    const resp = await app.handle(
      new Request("http://localhost/payments/webhook/sumopod", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": svixId,
          "svix-timestamp": svixTimestamp,
          "svix-signature": sig,
        },
        body: rawBody,
      }),
    );
    expect(resp.status).toBe(200);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("paid");
    expect(donation?.paidAt).not.toBeNull();

    const [campaignAfter] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignAfter?.collectedAmount).toBe((campaignBefore?.collectedAmount ?? 0n) + 80000n);
    expect(campaignAfter?.donationCount).toBe((campaignBefore?.donationCount ?? 0) + 1);

    const [eventRow] = await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.providerEventId, `${sumopodPaymentId}:payment.completed`));
    expect(eventRow?.provider).toBe("sumopod");
  });
});
