import {
  CreateDonationBodySchema,
  CreateDonationResponseSchema,
  GetDonationResponseSchema,
  PaymentErrorSchema,
} from "@galangdana/contracts";
import {
  allocationPolicies,
  campaigns,
  db,
  donations,
  idempotencyKeys,
  notificationsOutbox,
  paymentEvents,
  payments,
} from "@galangdana/db";
import { moneyToJSON } from "@galangdana/money";
import { MockPaymentProvider } from "@galangdana/payments";
import type { Static } from "@sinclair/typebox";
import { and, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

const SERVER_KEY = process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev";

function getProvider() {
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}

export const donationsRoute = new Elysia()
  .use(sessionDerive)
  .post(
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

      // Everything from here on either commits a full donation (via the
      // transaction below) or releases the claimed key in the catch block
      // below -- so a transient failure (bad input, missing policy row, a
      // provider error) never permanently poisons this idempotency key. An
      // early `return` (the 404 below) has to release the claim itself,
      // since it doesn't go through the catch.
      try {
        const [campaign] = await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, body.campaignId));
        if (!campaign) {
          await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, idempotencyKey));
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

        // Pre-generate the id and create the provider charge BEFORE opening a
        // DB transaction -- createCharge is a network call in a real
        // (non-mock) provider, and holding a transaction open across that
        // would be a problem waiting to happen once this mock is swapped for
        // a real Midtrans adapter.
        const donationId = crypto.randomUUID();
        const provider = getProvider();
        const charge = await provider.createCharge({
          orderId: donationId,
          grossAmount: amount,
          currency: campaign.currency,
        });

        const responseBody = await db.transaction(async (tx) => {
          await tx.insert(donations).values({
            id: donationId,
            userId: user?.id,
            campaignId: campaign.id,
            allocationPolicyId: policy.id,
            amount,
            currency: campaign.currency,
            platformFee,
            isAnonymous: body.isAnonymous ?? false,
            comment: body.comment,
          });

          await tx.insert(payments).values({
            donationId,
            provider: "mock",
            method: charge.method,
            providerOrderId: charge.providerOrderId,
            vaNumber: charge.vaNumber,
            grossAmount: amount,
            expiresAt: charge.expiresAt,
          });

          const body_: Static<typeof CreateDonationResponseSchema> = {
            donationId,
            vaNumber: charge.vaNumber,
            amount: moneyToJSON({ amount, currency: campaign.currency }),
            expiresAt: charge.expiresAt.toISOString(),
          };

          await tx
            .update(idempotencyKeys)
            .set({ responseBody: body_ })
            .where(eq(idempotencyKeys.key, idempotencyKey));

          return body_;
        });

        return responseBody;
      } catch (err) {
        // Release the claim so a genuine retry (not just a duplicate
        // double-tap) can actually succeed instead of getting stuck behind a
        // 409 forever.
        await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, idempotencyKey));
        throw err;
      }
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
  )
  .post(
    "/payments/webhook",
    async ({ request, set }) => {
      const provider = getProvider();
      let event: Awaited<ReturnType<typeof provider.parseWebhook>>;
      try {
        event = await provider.parseWebhook(request);
      } catch {
        set.status = 401;
        return { error: "invalid_signature" };
      }

      const result = await db.transaction(async (tx) => {
        // First write: the dedup guard. A retried/duplicate delivery hits
        // this table's UNIQUE(provider, providerEventId) constraint and
        // throws before any other write happens. Run it in a nested
        // transaction (SAVEPOINT) rather than directly against `tx`:
        // postgres.js's `begin()` tracks the first error seen by ANY query
        // run through its transaction-scoped `sql` tag in a closure
        // variable independent of whatever `try/catch` wraps that query in
        // JS, then rethrows it after the callback resolves -- so catching
        // this insert's rejection here would NOT stop the outer
        // transaction from still failing at commit time with that same
        // error. A savepoint gets its own independent error-tracking scope,
        // so catching its rejection here really does let the outer
        // transaction commit cleanly.
        try {
          await tx.transaction(async (tx2) => {
            await tx2.insert(paymentEvents).values({
              provider: "mock",
              providerEventId: event.providerEventId,
              payload: event.rawPayload as object,
            });
          });
        } catch (err) {
          if ((err as { code?: string }).code === "23505") {
            return { alreadyProcessed: true as const };
          }
          throw err;
        }

        if (event.status !== "paid") {
          await tx
            .update(payments)
            .set({ status: event.status, updatedAt: new Date() })
            .where(eq(payments.providerOrderId, event.providerOrderId));
          return { alreadyProcessed: false as const, paid: false as const };
        }

        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.providerOrderId, event.providerOrderId));
        if (!payment) {
          throw new Error(`webhook for unknown providerOrderId: ${event.providerOrderId}`);
        }

        const now = new Date();
        const updatedDonations = await tx
          .update(donations)
          .set({ status: "paid", paidAt: now, updatedAt: now })
          .where(and(eq(donations.id, payment.donationId), eq(donations.status, "pending")))
          .returning();
        if (updatedDonations.length === 0) {
          // Already paid by a prior delivery that beat the payment_events
          // dedup guard in a genuine race (two concurrent deliveries both
          // inserting different providerEventIds for the same order) --
          // treat as already-processed, not an error.
          return { alreadyProcessed: true as const };
        }
        const donation = updatedDonations[0];
        if (!donation) throw new Error("unreachable: update returned no row after length check");

        await tx
          .update(payments)
          .set({ status: "paid", updatedAt: now })
          .where(eq(payments.id, payment.id));

        await tx
          .update(campaigns)
          .set({
            collectedAmount: sql`${campaigns.collectedAmount} + ${donation.amount}`,
            donationCount: sql`${campaigns.donationCount} + 1`,
          })
          .where(eq(campaigns.id, donation.campaignId));

        await tx.insert(notificationsOutbox).values({
          channel: "email",
          template: "donation_receipt",
          payload: { donationId: donation.id, campaignId: donation.campaignId },
        });

        return { alreadyProcessed: false as const, paid: true as const };
      });

      return { status: result.alreadyProcessed ? "already_processed" : "processed" };
    },
    {
      response: {
        200: t.Object({ status: t.String() }),
        401: PaymentErrorSchema,
      },
    },
  )
  .get(
    "/donations/:id",
    async ({ user, params, set }) => {
      const [row] = await db
        .select({ donation: donations, payment: payments })
        .from(donations)
        .innerJoin(payments, eq(payments.donationId, donations.id))
        .where(eq(donations.id, params.id));
      if (!row) {
        set.status = 404;
        return { error: "donation_not_found" };
      }
      if (row.donation.userId && row.donation.userId !== user?.id) {
        set.status = 404;
        return { error: "donation_not_found" };
      }
      return {
        id: row.donation.id,
        campaignId: row.donation.campaignId,
        amount: moneyToJSON({ amount: row.donation.amount, currency: row.donation.currency }),
        status: row.donation.status,
        vaNumber: row.payment.vaNumber,
        expiresAt: row.payment.expiresAt.toISOString(),
        paidAt: row.donation.paidAt?.toISOString() ?? null,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: GetDonationResponseSchema, 404: PaymentErrorSchema },
    },
  );
