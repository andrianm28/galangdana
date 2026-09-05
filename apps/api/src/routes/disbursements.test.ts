import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  bankAccounts,
  campaignCategories,
  campaigners,
  campaigns,
  db,
  disbursementRequests,
  displayAmount,
  donations,
  otpChallenges,
  payments,
  sessions,
  users,
} from "@galangdana/db";
import { MockPaymentProvider } from "@galangdana/payments";
import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { requestOtp } from "../auth/otp";
import type { SmsProvider } from "../auth/sms-provider";
import { redis } from "../lib/redis-client";
import { computeWithdrawableAmount, disbursementsRoute } from "./disbursements";
import { donationsRoute } from "./donations";

// donations.ts's mock provider fails closed if this is unset (see
// donations.ts's getMockProvider) -- this test run relies on .env
// providing it, same as donations.test.ts. Typed as a genuine `string` via
// this IIFE, not `string | undefined` narrowed by a guard: createPaidDonation
// below is a hoisted `function` declaration, and TypeScript doesn't carry a
// module-level guard's narrowing through a hoisted function's body (it's
// conservative about the function being callable before the guard runs).
const MOCK_MIDTRANS_SERVER_KEY: string = (() => {
  const value = process.env.MOCK_MIDTRANS_SERVER_KEY;
  if (!value) {
    throw new Error("MOCK_MIDTRANS_SERVER_KEY must be set to run this test file (see .env)");
  }
  return value;
})();

class CapturingSmsProvider implements SmsProvider {
  lastCode: string | null = null;
  async sendOtp(_phone: string, code: string): Promise<void> {
    this.lastCode = code;
  }
}

// requestOtp/verifyOtp go through the real route with the default
// ConsoleSmsProvider (never a test double), so the only way to learn the
// actual code a test needs to verify is to request a second, fresher
// challenge directly through the OTP module with a capturing provider --
// the same workaround routes/auth.test.ts uses for the login OTP route.
// verifyOtp always picks the LATEST unconsumed challenge for the given
// phone+purpose, so this fresh code is the one that will be checked.
async function requestFreshOtpCode(phone: string, purpose: "login" | "disbursement") {
  const sms = new CapturingSmsProvider();
  const result = await requestOtp(phone, purpose, sms);
  if (!result.sent || !sms.lastCode) {
    throw new Error(`requestOtp failed to send a code: ${JSON.stringify(result)}`);
  }
  return sms.lastCode;
}

// The withdrawable-balance tests need a real paid donation, which only
// exists after going through POST /donations + POST /payments/webhook (both
// live on donationsRoute) -- so this file exercises a small combined app
// rather than disbursementsRoute alone.
const app = new Elysia().use(donationsRoute).use(disbursementsRoute);

const TEST_USER_ID = "44444444-5555-6666-7777-cccccccccc01";
const OTHER_USER_ID = "44444444-5555-6666-7777-cccccccccc02";
const ADMIN_USER_ID = "44444444-5555-6666-7777-cccccccccc03";
const TEST_TOKEN = "disbursements-test-token";
const OTHER_TOKEN = "disbursements-other-token";
const ADMIN_TOKEN = "disbursements-admin-token";
const TEST_USER_PHONE = "+6281199990601";

let categoryId: number;
let testCampaignerId: string;
let otherCampaignerId: string;

// Every row this file creates is tracked here and deleted in `afterAll`, in
// FK-safe order -- there is no existing precedent to copy for this (see
// this task's brief: donations.test.ts's own seedTestCampaign() leaks a
// real active campaign per run with no cleanup at all).
const campaignIds: string[] = [];
const disbursementIds: string[] = [];
const donationIds: string[] = [];

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `session=${token}` } });
}

beforeAll(async () => {
  await db.delete(users).where(inArray(users.id, [TEST_USER_ID, OTHER_USER_ID, ADMIN_USER_ID]));
  await db.insert(users).values([
    { id: TEST_USER_ID, phone: TEST_USER_PHONE },
    { id: OTHER_USER_ID, phone: "+6281199990602" },
    { id: ADMIN_USER_ID, phone: "+6281199990603", role: "admin" },
  ]);
  await db.insert(sessions).values([
    { id: TEST_TOKEN, userId: TEST_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: OTHER_TOKEN, userId: OTHER_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: ADMIN_TOKEN, userId: ADMIN_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  ]);

  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found -- run db:seed first");
  categoryId = category.id;

  const [campaigner] = await db
    .insert(campaigners)
    .values({
      type: "individual",
      displayName: "Disbursements Test Campaigner",
      userId: TEST_USER_ID,
    })
    .returning();
  if (!campaigner) throw new Error("campaigner insert failed");
  testCampaignerId = campaigner.id;

  const [otherCampaigner] = await db
    .insert(campaigners)
    .values({ type: "individual", displayName: "Other Campaigner", userId: OTHER_USER_ID })
    .returning();
  if (!otherCampaigner) throw new Error("other campaigner insert failed");
  otherCampaignerId = otherCampaigner.id;
});

afterAll(async () => {
  if (disbursementIds.length > 0) {
    await db.delete(disbursementRequests).where(inArray(disbursementRequests.id, disbursementIds));
  }
  if (donationIds.length > 0) {
    await db.delete(payments).where(inArray(payments.donationId, donationIds));
    await db.delete(donations).where(inArray(donations.id, donationIds));
  }
  if (campaignIds.length > 0) {
    await db.delete(campaigns).where(inArray(campaigns.id, campaignIds));
  }
  // Bank accounts created directly in the bank-account tests below are not
  // tracked separately -- bankAccounts.campaignerId cascades on delete, so
  // deleting these campaigners (after the disbursements above, which is
  // what actually references bankAccountId) cleans them up too.
  if (testCampaignerId) await db.delete(campaigners).where(eq(campaigners.id, testCampaignerId));
  if (otherCampaignerId) await db.delete(campaigners).where(eq(campaigners.id, otherCampaignerId));
  // disbursementRequests (deleted above, ahead of users) is what references
  // ADMIN_USER_ID via approvedBy (no cascade on that FK) -- deleting users
  // after disbursementRequests, same as the existing TEST_USER_ID/OTHER_USER_ID
  // ordering, is what keeps this FK-safe.
  await db.delete(users).where(inArray(users.id, [TEST_USER_ID, OTHER_USER_ID, ADMIN_USER_ID]));
  await db.delete(otpChallenges).where(eq(otpChallenges.phone, TEST_USER_PHONE));
  await redis.del(`otp:ratelimit:${TEST_USER_PHONE}`);
});

async function createTestCampaign(campaignerId: string, status: "draft" | "active" = "active") {
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `test-disbursement-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Test Disbursement Campaign",
      shortDescription: "Test",
      story: "Test",
      categoryId,
      campaignerId,
      type: "donation",
      currency: "IDR",
      model: "goal",
      goalAmount: 100_000_000n,
      status,
      // A real active campaign always has these set; a null publishedAt
      // sorts first under GET /campaigns's default DESC ordering
      // (Postgres's NULLS FIRST), which previously corrupted
      // campaigns.test.ts's sort assertions whenever this row was still
      // present in the shared test database -- see the
      // campaigns-test-isolation-gap memory this was tracked under.
      publishedAt: status === "active" ? new Date() : null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  campaignIds.push(campaign.id);
  return campaign;
}

// "program"-model campaigns (unlike this file's default "goal" model) are
// the only ones where displayAmount() actually subtracts disbursedAmount
// (a "goal" campaign's displayAmount is cumulative collectedAmount,
// unaffected by disbursements) -- needed to exercise that formula for
// real. The check constraint on campaigns.model requires goalAmount and
// expiresAt to both be NULL for "program", not just omitted.
async function createProgramTestCampaign(campaignerId: string) {
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `test-disbursement-program-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Test Disbursement Program Campaign",
      shortDescription: "Test",
      story: "Test",
      categoryId,
      campaignerId,
      type: "donation",
      currency: "IDR",
      model: "program",
      status: "active",
      publishedAt: new Date(),
    })
    .returning();
  if (!campaign) throw new Error("program campaign insert failed");
  campaignIds.push(campaign.id);
  return campaign;
}

async function createDraftDisbursement(campaignId: string, token: string) {
  const resp = await app.handle(
    authedRequest(`http://localhost/campaigns/${campaignId}/disbursements`, token, {
      method: "POST",
    }),
  );
  if (resp.status !== 200) throw new Error(`draft disbursement creation failed: ${resp.status}`);
  const body = (await resp.json()) as { id: string };
  disbursementIds.push(body.id);
  return body.id;
}

async function createPaidDonation(campaignId: string, amountStr: string) {
  const donationResp = await app.handle(
    new Request("http://localhost/donations", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ campaignId, amountStr, paymentMethod: "bank_transfer_va" }),
    }),
  );
  const { donationId } = (await donationResp.json()) as { donationId: string };
  donationIds.push(donationId);

  const [payment] = await db.select().from(payments).where(eq(payments.donationId, donationId));
  if (!payment) throw new Error("payment row missing");

  const provider = new MockPaymentProvider({ serverKey: MOCK_MIDTRANS_SERVER_KEY });
  const payload = await provider.simulateWebhookPayload(payment.providerOrderId, BigInt(amountStr));
  const webhookResp = await app.handle(
    new Request("http://localhost/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  if (webhookResp.status !== 200)
    throw new Error(`webhook processing failed: ${webhookResp.status}`);

  const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
  if (!donation) throw new Error("donation missing after webhook");
  return donation;
}

describe("POST /campaigns/:id/disbursements", () => {
  test("creates a draft disbursement for an owned, active campaign", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/disbursements`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string };
    disbursementIds.push(body.id);
    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, body.id));
    expect(row?.status).toBe("draft");
    expect(row?.campaignId).toBe(campaign.id);
  });

  test("409s for a non-active campaign", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "draft");
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/disbursements`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("campaign_not_active");
  });

  test("404s (not 403) for someone else's campaign", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/disbursements`, OTHER_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(404);
  });

  test("401s with no session", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const resp = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.id}/disbursements`, { method: "POST" }),
    );
    expect(resp.status).toBe(401);
  });
});

describe("PATCH /disbursements/:id/bank-account", () => {
  test("saves the campaigner's own bank account onto a draft disbursement", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const [bankAccount] = await db
      .insert(bankAccounts)
      .values({
        campaignerId: testCampaignerId,
        bankCode: "bca",
        bankName: "Bank Central Asia",
        accountNumber: "1111111111",
        accountHolderName: "Test Campaigner",
      })
      .returning();
    if (!bankAccount) throw new Error("bank account insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/bank-account`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankAccountId: bankAccount.id }),
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.bankAccountId).toBe(bankAccount.id);
  });

  test("422s when the bank account belongs to a different campaigner", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const [otherBankAccount] = await db
      .insert(bankAccounts)
      .values({
        campaignerId: otherCampaignerId,
        bankCode: "bni",
        bankName: "Bank Negara Indonesia",
        accountNumber: "2222222222",
        accountHolderName: "Other Campaigner",
      })
      .returning();
    if (!otherBankAccount) throw new Error("other bank account insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/bank-account`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankAccountId: otherBankAccount.id }),
      }),
    );
    expect(resp.status).toBe(422);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("bank_account_not_found");
  });

  test("409s when the disbursement is no longer a draft, even though it was draft when read", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const [bankAccount] = await db
      .insert(bankAccounts)
      .values({
        campaignerId: testCampaignerId,
        bankCode: "bca",
        bankName: "Bank Central Asia",
        accountNumber: "3333333333",
        accountHolderName: "Test Campaigner",
      })
      .returning();
    if (!bankAccount) throw new Error("bank account insert failed");

    // Simulate a concurrent transition (e.g. Task 7's OTP-verify flow, or
    // a second in-flight request) racing ahead of this request's own
    // findOwnedDisbursement read -- the guarded UPDATE's own
    // `AND status = 'draft'` clause must be what rejects this, not a
    // stale pre-read check.
    await db
      .update(disbursementRequests)
      .set({ status: "requested" })
      .where(eq(disbursementRequests.id, id));

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/bank-account`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankAccountId: bankAccount.id }),
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("disbursement_not_editable");

    // And the write genuinely did not apply.
    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.bankAccountId).toBeNull();
  });
});

describe("PATCH /disbursements/:id/detail", () => {
  test("rejects an amount exceeding the withdrawable balance", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "200000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/detail`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "partial",
          amountStr: (withdrawable + 1n).toString(),
          narrative: "Too much",
        }),
      }),
    );
    expect(resp.status).toBe(422);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("amount_exceeds_withdrawable_balance");
  });

  test("409s when the disbursement is no longer a draft", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "200000");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    await db
      .update(disbursementRequests)
      .set({ status: "requested" })
      .where(eq(disbursementRequests.id, id));

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/detail`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "partial", amountStr: "1000", narrative: "x" }),
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("disbursement_not_editable");
  });
});

describe("withdrawable balance across two in-flight disbursement requests", () => {
  test("a draft disbursement does not reserve funds, but a requested one does", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const donation = await createPaidDonation(campaign.id, "1000000");

    const [freshCampaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    if (!freshCampaign) throw new Error("campaign missing after paid donation");

    const initialWithdrawable = await computeWithdrawableAmount(campaign.id);
    const expectedInitial =
      freshCampaign.collectedAmount - donation.platformFee - freshCampaign.disbursedAmount;
    expect(initialWithdrawable).toBe(expectedInitial);

    // Leave a small remainder so the reduced balance after id1 becomes
    // "requested" is still nonzero and independently checkable below.
    const amount1 = initialWithdrawable - 1n;
    expect(amount1).toBeGreaterThan(0n);

    const id1 = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const detail1Resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id1}/detail`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "partial",
          amountStr: amount1.toString(),
          narrative: "Request 1",
        }),
      }),
    );
    expect(detail1Resp.status).toBe(200);

    // id1 is still `draft` -- it must NOT count toward pendingDisbursementsAmount,
    // so a second, independent draft can request the exact same amount.
    const id2 = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const detail2Resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id2}/detail`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "partial",
          amountStr: amount1.toString(),
          narrative: "Request 2",
        }),
      }),
    );
    expect(detail2Resp.status).toBe(200);

    // Simulate Task 7's OTP-verify -> "requested" transition directly --
    // that route doesn't exist yet in this task.
    await db
      .update(disbursementRequests)
      .set({ status: "requested" })
      .where(eq(disbursementRequests.id, id1));

    const withdrawableAfterRequest = await computeWithdrawableAmount(campaign.id);
    expect(withdrawableAfterRequest).toBe(initialWithdrawable - amount1);

    // A third disbursement now correctly sees the reduced balance: the
    // same amount that succeeded twice above is now rejected.
    const id3 = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const detail3Resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id3}/detail`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "partial",
          amountStr: amount1.toString(),
          narrative: "Request 3",
        }),
      }),
    );
    expect(detail3Resp.status).toBe(422);
    const detail3Body = (await detail3Resp.json()) as { error: string };
    expect(detail3Body.error).toBe("amount_exceeds_withdrawable_balance");

    // But requesting exactly the tiny remaining balance still succeeds,
    // confirming the reduced figure is exact, not just "smaller".
    const detail3RetryResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id3}/detail`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "partial",
          amountStr: withdrawableAfterRequest.toString(),
          narrative: "Request 3 retry",
        }),
      }),
    );
    expect(detail3RetryResp.status).toBe(200);
  });
});

describe("POST /disbursements/:id/proof/presign + /confirm", () => {
  test("presign -> real MinIO PUT -> confirm round trip sets proofObjectKey", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const presignResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/proof/presign`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "bukti-transfer.jpg" }),
      }),
    );
    expect(presignResp.status).toBe(200);
    const { uploadUrl, objectKey } = (await presignResp.json()) as {
      uploadUrl: string;
      objectKey: string;
    };
    expect(objectKey).toStartWith(`disbursements/${id}/proof/`);

    const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake proof bytes" });
    expect(putResp.ok).toBe(true);

    const confirmResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/proof/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectKey }),
      }),
    );
    expect(confirmResp.status).toBe(200);

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.proofObjectKey).toBe(objectKey);
  });

  test("400s when the objectKey doesn't match this disbursement's own prefix", async () => {
    const campaignA = await createTestCampaign(testCampaignerId, "active");
    const campaignB = await createTestCampaign(testCampaignerId, "active");
    const idA = await createDraftDisbursement(campaignA.id, TEST_TOKEN);
    const idB = await createDraftDisbursement(campaignB.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${idA}/proof/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectKey: `disbursements/${idB}/proof/x.jpg` }),
      }),
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("object_key_mismatch");
  });

  test("409s when the disbursement is no longer a draft, even though it was draft when read", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);

    // Simulate a concurrent transition racing ahead of this request's own
    // findOwnedDisbursement read -- the guarded UPDATE's own
    // `AND status = 'draft'` clause must be what rejects this, not a
    // stale pre-read check.
    await db
      .update(disbursementRequests)
      .set({ status: "requested" })
      .where(eq(disbursementRequests.id, id));

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/proof/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectKey: `disbursements/${id}/proof/x.jpg` }),
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("disbursement_not_editable");

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.proofObjectKey).toBeNull();
  });
});

describe("GET /disbursements/:id", () => {
  test("404s for a nonexistent disbursement id", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/disbursements/00000000-0000-0000-0000-000000000000",
        TEST_TOKEN,
      ),
    );
    expect(resp.status).toBe(404);
  });

  test("404s (not 403) for another user's disbursement", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}`, OTHER_TOKEN),
    );
    expect(resp.status).toBe(404);
  });

  test("returns the disbursement detail for its owner", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}`, TEST_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; status: string; campaignId: string };
    expect(body.id).toBe(id);
    expect(body.status).toBe("draft");
    expect(body.campaignId).toBe(campaign.id);
  });
});

async function saveBankAndDetail(id: string, amount: bigint) {
  const [bankAccount] = await db
    .insert(bankAccounts)
    .values({
      campaignerId: testCampaignerId,
      bankCode: "bca",
      bankName: "Bank Central Asia",
      accountNumber: `otp-flow-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      accountHolderName: "Test Campaigner",
    })
    .returning();
  if (!bankAccount) throw new Error("bank account insert failed");
  const bankResp = await app.handle(
    authedRequest(`http://localhost/disbursements/${id}/bank-account`, TEST_TOKEN, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bankAccountId: bankAccount.id }),
    }),
  );
  if (bankResp.status !== 200) throw new Error(`bank-account save failed: ${bankResp.status}`);
  const detailResp = await app.handle(
    authedRequest(`http://localhost/disbursements/${id}/detail`, TEST_TOKEN, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "partial",
        amountStr: amount.toString(),
        narrative: "OTP flow test",
      }),
    }),
  );
  if (detailResp.status !== 200) throw new Error(`detail save failed: ${detailResp.status}`);
}

async function uploadProof(id: string) {
  const presignResp = await app.handle(
    authedRequest(`http://localhost/disbursements/${id}/proof/presign`, TEST_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "bukti-transfer.jpg" }),
    }),
  );
  if (presignResp.status !== 200) throw new Error(`proof presign failed: ${presignResp.status}`);
  const { uploadUrl, objectKey } = (await presignResp.json()) as {
    uploadUrl: string;
    objectKey: string;
  };
  const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake proof bytes" });
  if (!putResp.ok) throw new Error(`proof PUT failed: ${putResp.status}`);
  const confirmResp = await app.handle(
    authedRequest(`http://localhost/disbursements/${id}/proof/confirm`, TEST_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectKey }),
    }),
  );
  if (confirmResp.status !== 200) throw new Error(`proof confirm failed: ${confirmResp.status}`);
  return objectKey;
}

// "OTP ready" means complete enough for otp/request to accept it: bank
// account, amount/type, AND proof all set -- otp/request's completeness
// check requires all four (proofObjectKey included, so a disbursement can
// never reach Task 8's admin approval queue without proof-of-need on
// file).
async function makeOtpReadyDraft(campaignId: string, amount: bigint) {
  const id = await createDraftDisbursement(campaignId, TEST_TOKEN);
  await saveBankAndDetail(id, amount);
  await uploadProof(id);
  return id;
}

// Drives a fresh draft all the way to `requested` through the real
// otp/request -> otp/verify -> submit route chain (Task 7), resetting the
// shared 3-per-hour otp:ratelimit bucket first since this helper is called
// from many independent admin-flow tests below, not just the one describe
// block that already owned that reset.
async function driveDisbursementToRequested(campaignId: string, amount: bigint) {
  const id = await makeOtpReadyDraft(campaignId, amount);
  await redis.del(`otp:ratelimit:${TEST_USER_PHONE}`);
  const otpRequestResp = await app.handle(
    authedRequest(`http://localhost/disbursements/${id}/otp/request`, TEST_TOKEN, {
      method: "POST",
    }),
  );
  if (otpRequestResp.status !== 200)
    throw new Error(`otp/request failed: ${otpRequestResp.status}`);
  const code = await requestFreshOtpCode(TEST_USER_PHONE, "disbursement");
  const verifyResp = await app.handle(
    authedRequest(`http://localhost/disbursements/${id}/otp/verify`, TEST_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
  if (verifyResp.status !== 200) throw new Error(`otp/verify failed: ${verifyResp.status}`);
  const submitResp = await app.handle(
    authedRequest(`http://localhost/disbursements/${id}/submit`, TEST_TOKEN, { method: "POST" }),
  );
  if (submitResp.status !== 200) throw new Error(`submit failed: ${submitResp.status}`);
  return id;
}

async function driveDisbursementToApproved(campaignId: string, amount: bigint) {
  const id = await driveDisbursementToRequested(campaignId, amount);
  const approveResp = await app.handle(
    authedRequest(`http://localhost/admin/disbursements/${id}/approve`, ADMIN_TOKEN, {
      method: "POST",
    }),
  );
  if (approveResp.status !== 200) throw new Error(`approve failed: ${approveResp.status}`);
  return id;
}

describe("Disbursement OTP request/verify + submit", () => {
  // Every test below either calls the /otp/request route or requestOtp
  // directly (to capture a real code) against the same fixed
  // TEST_USER_PHONE, all sharing the 3-per-hour otp:ratelimit Redis
  // bucket -- reset before each test so tests don't interfere with each
  // other, and reruns of this suite within the same hour don't
  // eventually flip a genuinely valid request into a 429 (the same
  // fixed-value test-idempotency class already handled in auth.test.ts
  // and otp.test.ts).
  beforeEach(async () => {
    await redis.del(`otp:ratelimit:${TEST_USER_PHONE}`);
  });

  test("full happy path: create -> bank account -> detail -> proof -> otp/request -> otp/verify -> submit", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    // makeOtpReadyDraft below covers the create -> bank account -> detail
    // -> proof steps (a real presign -> MinIO PUT -> confirm round trip,
    // same as the dedicated proof/presign+confirm describe block above).
    const id = await makeOtpReadyDraft(campaign.id, withdrawable);
    const [afterProof] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(afterProof?.proofObjectKey).toStartWith(`disbursements/${id}/proof/`);

    const otpRequestResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/otp/request`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(otpRequestResp.status).toBe(200);
    const otpRequestBody = (await otpRequestResp.json()) as { sent: boolean };
    expect(otpRequestBody.sent).toBe(true);
    const [afterRequest] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(afterRequest?.status).toBe("otp_pending");

    const code = await requestFreshOtpCode(TEST_USER_PHONE, "disbursement");
    const otpVerifyResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/otp/verify`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
    );
    expect(otpVerifyResp.status).toBe(200);
    const otpVerifyBody = (await otpVerifyResp.json()) as { verified: boolean };
    expect(otpVerifyBody.verified).toBe(true);
    const [afterVerify] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(afterVerify?.status).toBe("otp_pending");
    expect(afterVerify?.otpVerifiedAt).not.toBeNull();

    const submitResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/submit`, TEST_TOKEN, { method: "POST" }),
    );
    expect(submitResp.status).toBe(200);
    const submitBody = (await submitResp.json()) as { status: string };
    expect(submitBody.status).toBe("requested");
    const [afterSubmit] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(afterSubmit?.status).toBe("requested");
  });

  test("otp/request rechecks the withdrawable balance: two drafts each saved with the full balance -- the first succeeds, the second is rejected", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);

    // Both drafts are independently saved with the FULL withdrawable
    // amount -- allowed, since neither draft counts toward
    // pendingDisbursementsAmount until it leaves `draft` (see the
    // "withdrawable balance across two in-flight disbursement requests"
    // describe block above, which proves the detail-save step alone lets
    // this happen).
    const id1 = await makeOtpReadyDraft(campaign.id, withdrawable);
    const id2 = await makeOtpReadyDraft(campaign.id, withdrawable);

    const firstResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id1}/otp/request`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(firstResp.status).toBe(200);
    const [afterFirst] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id1));
    expect(afterFirst?.status).toBe("otp_pending");

    // id1 is now otp_pending and correctly counts against the pending sum,
    // so id2's identical amount now overdraws the balance -- this is the
    // check that closes the actual double-disbursement scenario.
    const secondResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id2}/otp/request`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(secondResp.status).toBe(422);
    const secondBody = (await secondResp.json()) as { error: string };
    expect(secondBody.error).toBe("amount_exceeds_withdrawable_balance");

    const [afterSecond] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id2));
    expect(afterSecond?.status).toBe("draft");
  });

  test("otp/verify with an incorrect code does not advance past otp_pending", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await makeOtpReadyDraft(campaign.id, withdrawable);

    const otpRequestResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/otp/request`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(otpRequestResp.status).toBe(200);

    const verifyResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/otp/verify`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "000000" }),
      }),
    );
    expect(verifyResp.status).toBe(422);

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("otp_pending");
    expect(row?.otpVerifiedAt).toBeNull();
  });

  test("submit without a prior otp/verify 409s and does not advance status", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    // Skip the real otp/request flow (no rate-limit slot needed) -- only
    // the status transition matters for this test, matching the
    // precedent set by the other describe blocks above that simulate a
    // concurrent transition via a direct db.update.
    await db
      .update(disbursementRequests)
      .set({ status: "otp_pending" })
      .where(eq(disbursementRequests.id, id));

    const submitResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/submit`, TEST_TOKEN, { method: "POST" }),
    );
    expect(submitResp.status).toBe(409);
    const body = (await submitResp.json()) as { error: string };
    expect(body.error).toBe("otp_not_verified");

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("otp_pending");
  });

  test("otp/request on an incomplete draft 422s instead of crashing", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/otp/request`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(422);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("disbursement_incomplete");

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("draft");
  });

  test("otp/request 422s when bank account and detail are set but proof has not been uploaded", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    await saveBankAndDetail(id, withdrawable);

    const resp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/otp/request`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(422);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("disbursement_incomplete");

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("draft");
    expect(row?.proofObjectKey).toBeNull();
  });

  test("a login-purpose OTP challenge cannot satisfy this disbursement's otp/verify", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    // As above: only the otp_pending status matters for this test, so it
    // is set directly rather than via a real /otp/request call.
    await db
      .update(disbursementRequests)
      .set({ status: "otp_pending" })
      .where(eq(disbursementRequests.id, id));

    // An OTP challenge for the SAME phone but the "login" purpose,
    // completely unrelated to this disbursement -- re-verifies Task 3's
    // purpose-isolation guarantee holds through this route too, not just
    // at the otp.ts unit level.
    const loginCode = await requestFreshOtpCode(TEST_USER_PHONE, "login");

    const verifyResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/otp/verify`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: loginCode }),
      }),
    );
    expect(verifyResp.status).toBe(422);

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("otp_pending");
    expect(row?.otpVerifiedAt).toBeNull();
  });
});

describe("GET /admin/disbursements", () => {
  test("401s with no session", async () => {
    const resp = await app.handle(new Request("http://localhost/admin/disbursements"));
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const resp = await app.handle(
      authedRequest("http://localhost/admin/disbursements", TEST_TOKEN),
    );
    expect(resp.status).toBe(403);
  });

  test("defaults to the requested queue and does not list a draft disbursement", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToRequested(campaign.id, withdrawable);
    // A draft with no detail filled in -- must never appear in the default queue.
    await createDraftDisbursement(campaign.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest("http://localhost/admin/disbursements", ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      disbursements: Array<{
        id: string;
        campaignId: string;
        campaignTitle: string;
        status: string;
      }>;
    };
    const found = body.disbursements.find((d) => d.id === id);
    expect(found).toBeDefined();
    expect(found?.campaignId).toBe(campaign.id);
    expect(found?.campaignTitle).toBe(campaign.title);
    expect(found?.status).toBe("requested");
    expect(body.disbursements.every((d) => d.status === "requested")).toBe(true);
  });

  test("respects an explicit ?status= filter", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToApproved(campaign.id, withdrawable);

    const resp = await app.handle(
      authedRequest("http://localhost/admin/disbursements?status=approved", ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { disbursements: Array<{ id: string; status: string }> };
    const found = body.disbursements.find((d) => d.id === id);
    expect(found).toBeDefined();
    expect(found?.status).toBe("approved");
  });

  test("?status=draft returns 200 with type: null instead of crashing (draft disbursements have no type yet)", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest("http://localhost/admin/disbursements?status=draft", ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      disbursements: Array<{ id: string; type: string | null; status: string }>;
    };
    const found = body.disbursements.find((d) => d.id === id);
    expect(found).toBeDefined();
    expect(found?.status).toBe("draft");
    expect(found?.type).toBeNull();
  });
});

describe("GET /admin/disbursements/:id", () => {
  test("401s with no session", async () => {
    const resp = await app.handle(
      new Request("http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000"),
    );
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000",
        TEST_TOKEN,
      ),
    );
    expect(resp.status).toBe(403);
  });

  test("404s for a nonexistent disbursement id", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000",
        ADMIN_TOKEN,
      ),
    );
    expect(resp.status).toBe(404);
  });

  test("returns bank account, amount, and a presigned proof-view URL for a requested disbursement", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToRequested(campaign.id, withdrawable);

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}`, ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      id: string;
      campaignId: string;
      bankAccount: { bankName: string; accountNumber: string; accountHolderName: string };
      status: string;
      proofViewUrl: string | null;
    };
    expect(body.id).toBe(id);
    expect(body.campaignId).toBe(campaign.id);
    expect(body.bankAccount.bankName).toBe("Bank Central Asia");
    expect(body.status).toBe("requested");
    expect(body.proofViewUrl).toStartWith("http");
  });

  test("returns 200 with type: null instead of crashing, for a draft disbursement that has a bank account but no detail saved yet", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);
    const [bankAccount] = await db
      .insert(bankAccounts)
      .values({
        campaignerId: testCampaignerId,
        bankCode: "bca",
        bankName: "Bank Central Asia",
        accountNumber: `admin-detail-null-type-${Date.now()}`,
        accountHolderName: "Test Campaigner",
      })
      .returning();
    if (!bankAccount) throw new Error("bank account insert failed");
    const bankResp = await app.handle(
      authedRequest(`http://localhost/disbursements/${id}/bank-account`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankAccountId: bankAccount.id }),
      }),
    );
    if (bankResp.status !== 200) throw new Error(`bank-account save failed: ${bankResp.status}`);

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}`, ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { type: string | null; status: string };
    expect(body.type).toBeNull();
    expect(body.status).toBe("draft");
  });
});

describe("POST /admin/disbursements/:id/approve", () => {
  test("401s with no session", async () => {
    const resp = await app.handle(
      new Request(
        "http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000/approve",
        {
          method: "POST",
        },
      ),
    );
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000/approve",
        TEST_TOKEN,
        { method: "POST" },
      ),
    );
    expect(resp.status).toBe(403);
  });

  test("approves a requested disbursement and records approvedBy/approvedAt", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToRequested(campaign.id, withdrawable);

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/approve`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { status: string };
    expect(body.status).toBe("approved");

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("approved");
    expect(row?.approvedBy).toBe(ADMIN_USER_ID);
    expect(row?.approvedAt).not.toBeNull();
  });

  test("409s on a disbursement that is not requested (e.g. still draft)", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    const id = await createDraftDisbursement(campaign.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/approve`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("invalid_disbursement_status");
  });
});

describe("POST /admin/disbursements/:id/reject", () => {
  test("401s with no session", async () => {
    const resp = await app.handle(
      new Request(
        "http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000/reject",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "x" }),
        },
      ),
    );
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000/reject",
        TEST_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "x" }),
        },
      ),
    );
    expect(resp.status).toBe(403);
  });

  test("rejects a requested disbursement and records the reason", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToRequested(campaign.id, withdrawable);

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/reject`, ADMIN_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Bank account name mismatch" }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { status: string };
    expect(body.status).toBe("rejected");

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("rejected");
    expect(row?.rejectedReason).toBe("Bank account name mismatch");
  });

  test("409s on a disbursement that is not requested (e.g. already approved)", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToApproved(campaign.id, withdrawable);

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/reject`, ADMIN_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "too late" }),
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("invalid_disbursement_status");
  });
});

describe("POST /admin/disbursements/:id/pay", () => {
  test("401s with no session", async () => {
    const resp = await app.handle(
      new Request("http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000/pay", {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/admin/disbursements/00000000-0000-0000-0000-000000000000/pay",
        TEST_TOKEN,
        { method: "POST" },
      ),
    );
    expect(resp.status).toBe(403);
  });

  test("409s on a disbursement that is requested but not yet approved", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToRequested(campaign.id, withdrawable);

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/pay`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("invalid_disbursement_status");

    const [campaignRow] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignRow?.disbursedAmount).toBe(0n);
  });

  test("pays an approved disbursement exactly once: a second call 409s without double-incrementing disbursedAmount", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToApproved(campaign.id, withdrawable);

    const firstResp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/pay`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(firstResp.status).toBe(200);
    const firstBody = (await firstResp.json()) as { status: string };
    expect(firstBody.status).toBe("paid");

    const [afterFirst] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(afterFirst?.status).toBe("paid");
    expect(afterFirst?.payoutRef).toBe(`payout-${id}`);
    expect(afterFirst?.paidAt).not.toBeNull();

    const [campaignAfterFirst] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    expect(campaignAfterFirst?.disbursedAmount).toBe(withdrawable);

    const secondResp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/pay`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(secondResp.status).toBe(409);
    const secondBody = (await secondResp.json()) as { error: string };
    expect(secondBody.error).toBe("invalid_disbursement_status");

    // Exact final value asserted (not just "changed") -- confirms the second
    // call's guarded UPDATE genuinely applied zero writes, not that some
    // other coincidence kept the number stable.
    const [campaignAfterSecond] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    expect(campaignAfterSecond?.disbursedAmount).toBe(withdrawable);
  });

  test("two genuinely concurrent pay calls on the same approved disbursement: exactly one succeeds, disbursedAmount is incremented exactly once", async () => {
    const campaign = await createTestCampaign(testCampaignerId, "active");
    await createPaidDonation(campaign.id, "500000");
    const withdrawable = await computeWithdrawableAmount(campaign.id);
    const id = await driveDisbursementToApproved(campaign.id, withdrawable);

    // Fired via Promise.all with no sequencing (unlike the test above,
    // where the second call's pre-check -- `row.disbursement.status !==
    // "approved"` -- already short-circuits before getProvider/createPayout/
    // db.transaction are ever reached, since by then the first call has
    // already committed). Both requests here start from the SAME
    // `approved` snapshot, so both pass that pre-check and both reach the
    // real guarded `UPDATE ... WHERE status = 'approved' RETURNING` inside
    // the transaction -- this is what actually proves only one of them can
    // win that race, not just that a repeat call is rejected.
    const pay = () =>
      app.handle(
        authedRequest(`http://localhost/admin/disbursements/${id}/pay`, ADMIN_TOKEN, {
          method: "POST",
        }),
      );
    const [respA, respB] = await Promise.all([pay(), pay()]);
    const statuses = [respA.status, respB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = respA.status === 200 ? respA : respB;
    const loser = respA.status === 409 ? respA : respB;
    const winnerBody = (await winner.json()) as { status: string };
    expect(winnerBody.status).toBe("paid");
    const loserBody = (await loser.json()) as { error: string };
    expect(loserBody.error).toBe("invalid_disbursement_status");

    const [row] = await db
      .select()
      .from(disbursementRequests)
      .where(eq(disbursementRequests.id, id));
    expect(row?.status).toBe("paid");

    // The number that actually matters: disbursedAmount reflects exactly
    // one increment, read fresh from the DB after both concurrent calls
    // have fully resolved.
    const [campaignAfterConcurrentPay] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    expect(campaignAfterConcurrentPay?.disbursedAmount).toBe(withdrawable);
  });
});

describe("Admin payout execution reconciles the withdrawable-balance formula against real data", () => {
  test("collectedAmount/fees/disbursedAmount/withdrawable/displayAmount all reconcile after a real payout", async () => {
    // "program" model: displayAmount() only subtracts disbursedAmount for
    // this model (a "goal" campaign's displayAmount is cumulative
    // collectedAmount, never adjusted for disbursements) -- see
    // createProgramTestCampaign.
    const campaign = await createProgramTestCampaign(testCampaignerId);
    const donation = await createPaidDonation(campaign.id, "1000000");

    const [campaignAfterDonation] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    if (!campaignAfterDonation) throw new Error("campaign missing after paid donation");
    const collectedAmount = campaignAfterDonation.collectedAmount;
    const totalFees = donation.platformFee;

    const withdrawableBeforeDisbursement = await computeWithdrawableAmount(campaign.id);
    expect(withdrawableBeforeDisbursement).toBe(collectedAmount - totalFees);

    const disbursementAmount = withdrawableBeforeDisbursement;
    const id = await driveDisbursementToApproved(campaign.id, disbursementAmount);

    const payResp = await app.handle(
      authedRequest(`http://localhost/admin/disbursements/${id}/pay`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(payResp.status).toBe(200);
    const payBody = (await payResp.json()) as { status: string };
    expect(payBody.status).toBe("paid");

    const [campaignAfterPay] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    if (!campaignAfterPay) throw new Error("campaign missing after payout");

    // 1. disbursedAmount increased by exactly the disbursement's amount.
    expect(campaignAfterPay.disbursedAmount).toBe(disbursementAmount);
    // collectedAmount itself is untouched by a payout -- only disbursedAmount moves.
    expect(campaignAfterPay.collectedAmount).toBe(collectedAmount);

    // 2. computeWithdrawableAmount now reconciles to
    // collectedAmount - totalFees - disbursedAmount - 0 (no more pending,
    // this disbursement is now `paid`, not otp_pending/requested/approved).
    const withdrawableAfterPay = await computeWithdrawableAmount(campaign.id);
    expect(withdrawableAfterPay).toBe(
      collectedAmount - totalFees - campaignAfterPay.disbursedAmount,
    );
    expect(withdrawableAfterPay).toBe(0n);

    // 3. The public displayAmount() formula is untouched by this plan --
    // still exactly collectedAmount - disbursedAmount (no fee subtraction),
    // for a "program"-model campaign where that subtraction actually applies.
    expect(displayAmount(campaignAfterPay).amount).toBe(
      campaignAfterPay.collectedAmount - campaignAfterPay.disbursedAmount,
    );
  });
});
