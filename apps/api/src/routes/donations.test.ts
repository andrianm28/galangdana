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
} from "@fundforindonesia/db";
import { MockPaymentProvider, computeMidtransSignature } from "@fundforindonesia/payments";
import { eq, inArray } from "drizzle-orm";
import { hashSessionToken } from "../auth/session";
import { redis } from "../lib/redis-client";
import { donationsRoute } from "./donations";

const app = donationsRoute;

// donations.ts now requires SUMOPOD_WEBHOOK_SECRET and MOCK_MIDTRANS_SERVER_KEY
// to be set (fails closed otherwise -- see the "fails closed" describe block
// below), so this test run relies on .env providing both.
const SUMOPOD_WEBHOOK_SECRET = process.env.SUMOPOD_WEBHOOK_SECRET;
if (!SUMOPOD_WEBHOOK_SECRET) {
  throw new Error("SUMOPOD_WEBHOOK_SECRET must be set to run this test file (see .env)");
}
// Declared via an IIFE, matching disbursements.test.ts: a bare `const` plus a
// guard clause narrows only for code TypeScript sees after the guard, and a
// hoisted `function` body is not that -- so a helper declared with `function`
// sees `string | undefined` again.
const MOCK_MIDTRANS_SERVER_KEY: string = (() => {
  const value = process.env.MOCK_MIDTRANS_SERVER_KEY;
  if (!value) {
    throw new Error("MOCK_MIDTRANS_SERVER_KEY must be set to run this test file (see .env)");
  }
  return value;
})();

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
    {
      id: await hashSessionToken(TEST_TOKEN),
      userId: TEST_USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
    {
      id: await hashSessionToken(OTHER_TOKEN),
      userId: OTHER_USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
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

  // The contract's ^\d+$ pattern accepted "1". A Rp 1 donation costs more in
  // provider fees than it delivers, and a stream of them is the standard shape
  // of card-testing traffic. Enforced server-side because the client is not the
  // security boundary -- these requests bypass the UI entirely.
  test("422s a donation below the minimum, and creates nothing", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "1",
          paymentMethod: "bank_transfer_va",
        }),
      }),
    );
    expect(resp.status).toBe(422);
    expect(((await resp.json()) as { error: string }).error).toBe("amount_below_minimum");
  });

  test("422s a donation above the ceiling", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "500000001",
          paymentMethod: "bank_transfer_va",
        }),
      }),
    );
    expect(resp.status).toBe(422);
    expect(((await resp.json()) as { error: string }).error).toBe("amount_above_maximum");
  });

  // A rejected amount is a transient input error, not a permanent one: the
  // donor corrects the figure and retries. If the claim were not released the
  // retry would collide with its own key.
  test("releases the idempotency key when the amount is rejected, so a retry works", async () => {
    const campaign = await seedTestCampaign();
    const key = crypto.randomUUID();
    const body = (amountStr: string) =>
      JSON.stringify({ campaignId: campaign.id, amountStr, paymentMethod: "bank_transfer_va" });

    const rejected = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: body("1"),
      }),
    );
    expect(rejected.status).toBe(422);

    const retried = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: body("50000"),
      }),
    );
    expect(retried.status).toBe(200);
    const created = (await retried.json()) as { donationId: string };
    await db.delete(payments).where(eq(payments.donationId, created.donationId));
    await db.delete(donations).where(eq(donations.id, created.donationId));
  });

  // A guest donation has no users row, so before these columns the
  // donation_receipt outbox row written on settle had a donationId and no
  // destination -- undeliverable for the majority path.
  test("stores the donor's contact and display name so a receipt can be sent", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "50000",
          paymentMethod: "bank_transfer_va",
          contactChannel: "whatsapp",
          contactValue: "081234567890",
          displayName: "Rina",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const { donationId } = (await resp.json()) as { donationId: string };
    const [row] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(row?.contactChannel).toBe("whatsapp");
    expect(row?.contactValue).toBe("081234567890");
    expect(row?.displayName).toBe("Rina");
    await db.delete(payments).where(eq(payments.donationId, donationId));
    await db.delete(donations).where(eq(donations.id, donationId));
  });

  // Contact is optional: asking before taking money costs conversion, and the
  // donation must still complete without it.
  test("accepts a donation with no contact at all, storing nulls rather than empties", async () => {
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
    const { donationId } = (await resp.json()) as { donationId: string };
    const [row] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(row?.contactChannel).toBeNull();
    expect(row?.contactValue).toBeNull();
    expect(row?.displayName).toBeNull();
    await db.delete(payments).where(eq(payments.donationId, donationId));
    await db.delete(donations).where(eq(donations.id, donationId));
  });

  // A channel with no value is not a deliverable address; storing it would be
  // PII held for nothing.
  test("ignores a contact channel that arrives without a value", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "50000",
          paymentMethod: "bank_transfer_va",
          contactChannel: "email",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const { donationId } = (await resp.json()) as { donationId: string };
    const [row] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(row?.contactChannel).toBeNull();
    await db.delete(payments).where(eq(payments.donationId, donationId));
    await db.delete(donations).where(eq(donations.id, donationId));
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

// Hitting a real Sumopod host from this suite would make the tests
// network-dependent and flaky, so globalThis.fetch is stubbed -- the only way
// to exercise the real POST /donations -> getProvider("qris_redirect") ->
// SumopodProvider.createCharge path without a network call, while still
// proving the route wiring (not just an isolated `instanceof` check) works
// end-to-end.
//
// Matches on Sumopod's PATH, not its host. It used to match the literal
// "api-pay-sandbox.sumopod.com", back when that host was hardcoded in the
// provider. The host is now a required deployment variable, so a matcher
// keyed to one hostname silently stopped stubbing the moment an environment
// (CI) set a different one -- and fell through to a real DNS lookup.
async function withStubbedSumopodFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/v1/payments")) {
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

  test("422s for a malformed donation id, instead of a 500 from a raw Postgres uuid-syntax error", async () => {
    const resp = await app.handle(new Request("http://localhost/donations/not-a-uuid"));
    expect(resp.status).toBe(422);
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
  async function createTestDonation(
    amountStr: string,
    contact?: { contactChannel: "whatsapp" | "email"; contactValue: string },
  ) {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr,
          paymentMethod: "bank_transfer_va",
          ...contact,
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
      serverKey: MOCK_MIDTRANS_SERVER_KEY,
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
      serverKey: MOCK_MIDTRANS_SERVER_KEY,
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

  test("GET /donations/:id names the campaign and the donor's chosen name", async () => {
    // A receipt needs both. Without the title it says "campaign 8f3c-..."; a
    // second round trip to fetch it is a second chance to fail on a phone.
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "75000",
          paymentMethod: "bank_transfer_va",
          displayName: "Budi",
        }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };

    const get = await app.handle(new Request(`http://localhost/donations/${donationId}`));
    const body = (await get.json()) as {
      campaignTitle: string;
      campaignSlug: string;
      displayName: string | null;
    };
    expect(body.campaignTitle).toBe(campaign.title);
    expect(body.campaignSlug).toBe(campaign.slug);
    expect(body.displayName).toBe("Budi");
  });

  test("GET /donations/:id never returns the contact the donor gave", async () => {
    // Contact exists to send a receipt TO. Anyone holding the donation link
    // can read this response; a phone number is not theirs to read.
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "75000",
          paymentMethod: "bank_transfer_va",
          contactChannel: "whatsapp",
          contactValue: "081234567890",
        }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };

    const get = await app.handle(new Request(`http://localhost/donations/${donationId}`));
    const raw = await get.text();
    expect(raw).not.toContain("081234567890");
    expect(raw).not.toContain("contactValue");
    expect(raw).not.toContain("contactChannel");
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

  async function settle(providerOrderId: string, amount: bigint) {
    const provider = new MockPaymentProvider({ serverKey: MOCK_MIDTRANS_SERVER_KEY });
    const payload = await provider.simulateWebhookPayload(providerOrderId, amount);
    await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  }

  async function receiptRowsFor(donationId: string) {
    const rows = await db
      .select()
      .from(notificationsOutbox)
      .where(eq(notificationsOutbox.template, "donation_receipt"));
    return rows.filter((r) => (r.payload as { donationId?: string }).donationId === donationId);
  }

  test("enqueues a receipt addressed to the channel the donor chose", async () => {
    const { donationId, providerOrderId } = await createTestDonation("60000", {
      contactChannel: "whatsapp",
      contactValue: "081234567890",
    });
    await settle(providerOrderId, 60000n);

    const rows = await receiptRowsFor(donationId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.channel).toBe("whatsapp");
    expect((rows[0]?.payload as { contactValue?: string }).contactValue).toBe("081234567890");
  });

  test("enqueues nothing when the donor gave no contact, rather than an undeliverable row", async () => {
    // Contact is optional and most donors are guests. An unconditional enqueue
    // would build a permanent backlog of rows the worker can never deliver.
    const { donationId, providerOrderId } = await createTestDonation("60000");
    await settle(providerOrderId, 60000n);

    expect(await receiptRowsFor(donationId)).toEqual([]);
    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("paid");
  });

  test("an 'expire' webhook transitions a pending donation's status to expired", async () => {
    const { donationId, providerOrderId } = await createTestDonation("35000");
    const provider = new MockPaymentProvider({
      serverKey: MOCK_MIDTRANS_SERVER_KEY,
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
      serverKey: MOCK_MIDTRANS_SERVER_KEY,
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

describe("Mock payment provider webhook secret fails closed when unset", () => {
  test("a forged webhook is rejected, not accepted, when MOCK_MIDTRANS_SERVER_KEY is unset", async () => {
    // Forged against a REAL pending donation's providerOrderId, not a
    // made-up one -- see the identical Sumopod test above for why that
    // matters (a fabricated order id can't distinguish "signature
    // correctly rejected" from "signature wrongly accepted, but happens to
    // fail later because no order matched").
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "65000",
          paymentMethod: "bank_transfer_va",
        }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };
    const [payment] = await db.select().from(payments).where(eq(payments.donationId, donationId));
    if (!payment) throw new Error("payment row missing");

    // Must be the EXACT literal that used to be donations.ts's fail-open
    // fallback -- unlike a "some string was hardcoded" vulnerability, a
    // signature forged with a random guess would be rejected under BOTH
    // the vulnerable and the fixed code (it doesn't match either the
    // specific leaked literal or a genuinely-required real key), so a
    // random value here couldn't actually distinguish the two states.
    // This is the real, previously-committed value; asserting it's dead is
    // the whole point of this regression test.
    const forgedKey = "mock-server-key-for-dev";
    const signature = await computeMidtransSignature(
      { orderId: payment.providerOrderId, statusCode: "200", grossAmount: "65000.00" },
      forgedKey,
    );
    const rawBody = JSON.stringify({
      order_id: payment.providerOrderId,
      status_code: "200",
      gross_amount: "65000.00",
      transaction_status: "settlement",
      transaction_id: `evt-fail-closed-${Date.now()}`,
      signature_key: signature,
    });

    // donations.ts binds MOCK_MIDTRANS_SERVER_KEY into a module-level const
    // at import time (see getMockProvider), so this must run in a
    // genuinely fresh process with the env var unset -- see the identical
    // Sumopod test above for why each step here (filtering the key out of
    // the env object rather than deleting/undefining it, and
    // --env-file=/dev/null) is necessary rather than cosmetic.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "MOCK_MIDTRANS_SERVER_KEY"),
    );
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "--env-file=/dev/null",
        `${import.meta.dir}/__fixtures__/mock-webhook-fail-closed.fixture.ts`,
        rawBody,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).not.toBe("200");
    if (exitCode !== 0 && !stdout.trim()) {
      throw new Error(`fixture process failed unexpectedly: ${stderr}`);
    }

    // The property that actually matters: the forged webhook must not
    // have settled the real donation it targeted.
    const [donationAfter] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donationAfter?.status).toBe("pending");
  });
});

describe("availablePaymentMethods gates QRIS on every condition it needs", () => {
  // The gate used to check the webhook secret alone. Each of the other two
  // fails differently, and one of them fails SILENTLY.
  async function methodsWithEnv(
    removeKeys: string[] = [],
    extraEnv: Record<string, string> = {},
  ): Promise<string[]> {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !removeKeys.includes(key)),
    );
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "--env-file=/dev/null",
        `${import.meta.dir}/__fixtures__/payment-methods.fixture.ts`,
      ],
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) throw new Error(`probe failed: ${stderr}`);
    return JSON.parse(stdout.trim().split("\n").at(-1) as string) as string[];
  }

  test("offers QRIS when the secret, the key and the host are all set", async () => {
    expect(
      await methodsWithEnv([], {
        SUMOPOD_WEBHOOK_SECRET: "whsec_dGVzdA==",
        SUMOPOD_API_KEY: "k",
        SUMOPOD_BASE_URL: "https://sumopod.example.test",
      }),
    ).toContain("qris_redirect");
  });

  test("withholds QRIS when the API key is missing", async () => {
    // Otherwise the charge sends `X-Api-Key: ""`, Sumopod answers 401, and
    // the donor is told to try again -- forever.
    expect(
      await methodsWithEnv(["SUMOPOD_API_KEY"], {
        SUMOPOD_WEBHOOK_SECRET: "whsec_dGVzdA==",
        SUMOPOD_BASE_URL: "https://sumopod.example.test",
      }),
    ).not.toContain("qris_redirect");
  });

  test("withholds QRIS when the host is not stated, rather than charging the sandbox", async () => {
    // This is the silent one. A default host meant a forgotten variable sent
    // donors to a SANDBOX payment page: nothing errors, the sandbox webhook
    // verifies, the donation is marked paid, and collectedAmount goes up for
    // money that never moved.
    expect(
      await methodsWithEnv(["SUMOPOD_BASE_URL"], {
        SUMOPOD_WEBHOOK_SECRET: "whsec_dGVzdA==",
        SUMOPOD_API_KEY: "k",
      }),
    ).not.toContain("qris_redirect");
  });

  test("withholds QRIS when the webhook secret is missing", async () => {
    expect(
      await methodsWithEnv(["SUMOPOD_WEBHOOK_SECRET"], {
        SUMOPOD_API_KEY: "k",
        SUMOPOD_BASE_URL: "https://sumopod.example.test",
      }),
    ).not.toContain("qris_redirect");
  });
});

describe("Sumopod base URL configuration", () => {
  async function chargeUrlWithEnv(
    campaignId: string,
    removeKeys: string[] = [],
    extraEnv: Record<string, string> = {},
  ): Promise<{ url: string; body: { success_return_url: string; cancel_return_url: string } }> {
    // Same fresh-process necessity as the fail-closed fixtures above:
    // SUMOPOD_BASE_URL is bound at import time, so the override must be
    // present (or genuinely absent) in a new process's environment.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !removeKeys.includes(key)),
    );
    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        "--env-file=/dev/null",
        `${import.meta.dir}/__fixtures__/sumopod-base-url.fixture.ts`,
        campaignId,
      ],
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`fixture process failed: ${stderr} ${stdout}`);
    }
    const [url, rawBody] = stdout.trim().split("\n");
    if (!url || !rawBody) throw new Error(`fixture printed no charge call: ${stdout}`);
    const body = JSON.parse(rawBody) as { success_return_url: string; cancel_return_url: string };
    return { url, body };
  }

  test("creates no charge at all when SUMOPOD_BASE_URL is unset", async () => {
    // This test used to assert the opposite -- that an unset host quietly
    // fell back to the sandbox. That default is what made a forgotten
    // production variable book imaginary donations, so the charge is now
    // refused (503) instead of silently aimed at the sandbox.
    const campaign = await seedTestCampaign();
    await expect(chargeUrlWithEnv(campaign.id, ["SUMOPOD_BASE_URL"])).rejects.toThrow(
      /payment_method_unavailable/,
    );
  });

  test("posts the charge to SUMOPOD_BASE_URL when it is set", async () => {
    const campaign = await seedTestCampaign();
    const { url } = await chargeUrlWithEnv(campaign.id, [], {
      SUMOPOD_BASE_URL: "https://sumopod-prod.example.test",
    });
    expect(url).toBe("https://sumopod-prod.example.test/api/v1/payments");
  });

  test("return URLs default to PUBLIC_WEB_URL", async () => {
    const campaign = await seedTestCampaign();
    const { body } = await chargeUrlWithEnv(
      campaign.id,
      ["SUMOPOD_RETURN_BASE_URL", "PUBLIC_WEB_URL"],
      { SUMOPOD_BASE_URL: "https://sumopod.example.test" },
    );
    // Neither var set and no PUBLIC_WEB_URL: the code fallback
    // (localhost:5173) applies -- proving the default chain, not endorsing
    // localhost return URLs (Sumopod rejects those; see .env.example).
    expect(body.success_return_url).toMatch(/^http:\/\/localhost:5173\/donation\/status\//);
    expect(body.cancel_return_url).toMatch(/^http:\/\/localhost:5173\/donation\/status\//);
  });

  test("return URLs use SUMOPOD_RETURN_BASE_URL when it is set", async () => {
    const campaign = await seedTestCampaign();
    const { body } = await chargeUrlWithEnv(campaign.id, [], {
      SUMOPOD_RETURN_BASE_URL: "https://return.example.test",
    });
    expect(body.success_return_url).toMatch(/^https:\/\/return\.example\.test\/donation\/status\//);
    expect(body.cancel_return_url).toMatch(/^https:\/\/return\.example\.test\/donation\/status\//);
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

  test("a validly-signed payment.test webhook (Sumopod dashboard 'Save & Test' ping) returns 2xx and never touches a real donation", async () => {
    // A real pending donation whose providerOrderId a dashboard test ping
    // could never actually collide with (Sumopod doesn't echo back a real
    // order_id for this event type) -- proves the ping is a true no-op,
    // not just "no crash".
    const { donationId } = await createTestQrisDonation("90000");

    const rawBody = JSON.stringify({ event_type: "payment.test", data: {} });
    const svixId = `msg_${crypto.randomUUID()}`;
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const sig = await computeSumopodSignature(
      SUMOPOD_WEBHOOK_SECRET,
      svixId,
      svixTimestamp,
      rawBody,
    );

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
    expect(resp.status).toBeGreaterThanOrEqual(200);
    expect(resp.status).toBeLessThan(300);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("pending");
  });
});

describe("provider-scoped webhook payment lookup", () => {
  test("a validly-signed sumopod webhook cannot settle a payment that was actually created via mock/VA", async () => {
    // Both providers use the donation id as providerOrderId, and
    // payments.provider_order_id is globally UNIQUE -- so before this fix,
    // a webhook delivered to the sumopod route with a real VA payment's
    // providerOrderId would settle that VA payment, even though it was
    // never touched by Sumopod at all.
    const campaign = await seedTestCampaign();
    const createResp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: campaign.id,
          amountStr: "55000",
          paymentMethod: "bank_transfer_va",
        }),
      }),
    );
    const { donationId } = (await createResp.json()) as { donationId: string };
    const [vaPayment] = await db.select().from(payments).where(eq(payments.donationId, donationId));
    if (!vaPayment) throw new Error("payment row missing");

    const [campaignBefore] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));

    const rawBody = JSON.stringify({
      event_type: "payment.completed",
      data: {
        payment_id: `sumopod-cross-provider-${crypto.randomUUID()}`,
        order_id: vaPayment.providerOrderId,
        status: "completed",
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
    // The signature is genuinely valid for the sumopod route -- but the
    // matched providerOrderId belongs to a "mock" payment, not "sumopod",
    // so the provider-scoped lookup must find nothing and this must NOT
    // succeed as a settlement.
    expect(resp.status).not.toBe(200);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("pending");
    const [paymentAfter] = await db
      .select()
      .from(payments)
      .where(eq(payments.donationId, donationId));
    expect(paymentAfter?.status).toBe("pending");
    const [campaignAfter] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignAfter?.collectedAmount).toBe(campaignBefore?.collectedAmount);
    expect(campaignAfter?.donationCount).toBe(campaignBefore?.donationCount);
  });
});

describe("Sumopod webhook secret fails closed when unset", () => {
  test("a forged webhook is rejected, not accepted, when SUMOPOD_WEBHOOK_SECRET is unset", async () => {
    // Forged against a REAL pending donation's providerOrderId -- not a
    // made-up "irrelevant" one -- so this test can actually distinguish
    // "signature correctly rejected" from "signature wrongly accepted,
    // but happens to 500 later because no order matched." Both produce a
    // non-200 response, so asserting only `not.toBe("200")` against a
    // fabricated order id doesn't prove the signature check itself held.
    const { donationId, providerOrderId } = await createTestQrisDonation("65000");

    // Any string works here -- the vulnerability under test was a fixed
    // fail-open DEFAULT (donations.ts silently using some hardcoded value
    // whenever SUMOPOD_WEBHOOK_SECRET was unset), not that one specific
    // value. A truly-unset secret must reject every signature, not just
    // one particular guess, so generating a fresh value each run proves
    // the broader property and never becomes its own hardcoded credential.
    const forgedSecret = `whsec_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))}`;
    const rawBody = JSON.stringify({
      event_type: "payment.completed",
      data: {
        payment_id: "fail-closed-regression-test",
        order_id: providerOrderId,
        status: "completed",
      },
    });
    const svixId = `msg_${crypto.randomUUID()}`;
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const sig = await computeSumopodSignature(forgedSecret, svixId, svixTimestamp, rawBody);

    // donations.ts binds SUMOPOD_WEBHOOK_SECRET into a module-level const
    // at import time, so this must run in a genuinely fresh process with
    // the env var unset -- deleting it here (this file already imported
    // donations.ts at the top) would not affect the already-bound value.
    // An empty string is still "present" for a `?? "fallback"` check (only
    // null/undefined trigger it), so this must genuinely OMIT the key --
    // and setting it to `undefined` doesn't do that either: Bun.spawn's
    // `env` treats an `undefined`-valued key as "inherit from this
    // process's real env", which would silently leak the real secret
    // through and defeat this test. Filtering the key out of the object
    // entirely is the only option that truly unsets it for the child.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "SUMOPOD_WEBHOOK_SECRET"),
    );

    const proc = Bun.spawn({
      cmd: [
        "bun",
        "run",
        // Bun auto-loads .env from the cwd by default, which would
        // silently re-supply the real secret to the child even after
        // it's deleted from `env` above -- point it at /dev/null so the
        // child genuinely sees no secret.
        "--env-file=/dev/null",
        `${import.meta.dir}/__fixtures__/sumopod-webhook-fail-closed.fixture.ts`,
        svixId,
        svixTimestamp,
        sig,
        rawBody,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).not.toBe("200");
    if (exitCode !== 0 && !stdout.trim()) {
      throw new Error(`fixture process failed unexpectedly: ${stderr}`);
    }

    // The property that actually matters: the forged webhook must not
    // have settled the real donation it targeted.
    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("pending");
  });
});

describe("POST /donations rate limiting", () => {
  test("returns 429 when the campaign's donation budget is exhausted", async () => {
    const campaign = await seedTestCampaign();
    // Prime the fixed-window counter past the cap directly: walking the
    // real 120-request boundary here would add seconds per run, while the
    // boundary itself is covered in rate-limit.test.ts.
    await redis.set(`donation:ratelimit:${campaign.id}`, "9999");
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
    expect(resp.status).toBe(429);
    await redis.del(`donation:ratelimit:${campaign.id}`);
  });
});

