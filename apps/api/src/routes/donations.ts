import {
  CreateDonationBodySchema,
  CreateDonationResponseSchema,
  PaymentErrorSchema,
} from "@galangdana/contracts";
import {
  allocationPolicies,
  campaigns,
  db,
  donations,
  idempotencyKeys,
  payments,
} from "@galangdana/db";
import { moneyToJSON } from "@galangdana/money";
import { MockPaymentProvider } from "@galangdana/payments";
import type { Static } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

const SERVER_KEY = process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev";

function getProvider() {
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}

export const donationsRoute = new Elysia().use(sessionDerive).post(
  "/donations",
  async ({ user, body, headers, set }) => {
    const idempotencyKey = headers["idempotency-key"];
    if (!idempotencyKey) {
      set.status = 400;
      return { error: "missing_idempotency_key" };
    }

    // Claim the key FIRST via the unique constraint itself -- this is the
    // real concurrency guard (matches this project's established atomic-
    // transition pattern, and this same plan's own POST /payments/webhook
    // handler), not a separate read-then-write that would leave a race
    // window for two near-simultaneous requests with the same new key
    // (e.g. a user double-tapping "Donate" on a flaky connection -- the
    // exact scenario this header exists to protect against) to both
    // create a donation.
    const [claimed] = await db
      .insert(idempotencyKeys)
      .values({ key: idempotencyKey, endpoint: "POST /donations", responseBody: {} })
      .onConflictDoNothing({ target: idempotencyKeys.key })
      .returning();

    if (!claimed) {
      const [existingKey] = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey));
      if (!existingKey || Object.keys(existingKey.responseBody as object).length === 0) {
        // Another request already claimed this key and hasn't finished
        // yet -- this is a genuine in-flight duplicate, not an error the
        // client should treat as failure. It should retry shortly.
        set.status = 409;
        return { error: "request_in_progress" };
      }
      return existingKey.responseBody as Static<typeof CreateDonationResponseSchema>;
    }

    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, body.campaignId));
    if (!campaign) {
      set.status = 404;
      return { error: "campaign_not_found" };
    }

    const [policy] = await db
      .select()
      .from(allocationPolicies)
      .where(eq(allocationPolicies.isDefault, true));
    if (!policy) {
      throw new Error("no default allocation policy configured");
    }

    const amount = BigInt(body.amountStr);
    const platformFee = (amount * BigInt(policy.platformFeeBps)) / 10000n;

    const [donation] = await db
      .insert(donations)
      .values({
        userId: user?.id,
        campaignId: campaign.id,
        allocationPolicyId: policy.id,
        amount,
        currency: campaign.currency,
        platformFee,
        isAnonymous: body.isAnonymous ?? false,
        comment: body.comment,
      })
      .returning();
    if (!donation) throw new Error("donation insert returned no row");

    const provider = getProvider();
    const charge = await provider.createCharge({
      orderId: donation.id,
      grossAmount: amount,
      currency: campaign.currency,
    });

    await db.insert(payments).values({
      donationId: donation.id,
      provider: "mock",
      method: charge.method,
      providerOrderId: charge.providerOrderId,
      vaNumber: charge.vaNumber,
      grossAmount: amount,
      expiresAt: charge.expiresAt,
    });

    const responseBody = {
      donationId: donation.id,
      vaNumber: charge.vaNumber,
      amount: moneyToJSON({ amount, currency: campaign.currency }),
      expiresAt: charge.expiresAt.toISOString(),
    };

    await db
      .update(idempotencyKeys)
      .set({ responseBody })
      .where(eq(idempotencyKeys.key, idempotencyKey));

    return responseBody;
  },
  {
    headers: t.Object({ "idempotency-key": t.Optional(t.String()) }),
    body: CreateDonationBodySchema,
    response: {
      200: CreateDonationResponseSchema,
      400: PaymentErrorSchema,
      404: PaymentErrorSchema,
      409: PaymentErrorSchema,
    },
  },
);
