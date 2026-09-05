import {
  AdminDisbursementDetailSchema,
  AdminDisbursementListResponseSchema,
  AdminRejectDisbursementBodySchema,
  ConfirmDisbursementProofBodySchema,
  CreateDisbursementResponseSchema,
  DisbursementActionResponseSchema,
  DisbursementDetailSchema,
  DisbursementErrorSchema,
  PresignDisbursementProofBodySchema,
  PresignDisbursementProofResponseSchema,
  RequestDisbursementOtpResponseSchema,
  SaveDisbursementBankAccountBodySchema,
  SaveDisbursementDetailBodySchema,
  VerifyDisbursementOtpBodySchema,
  VerifyDisbursementOtpResponseSchema,
} from "@galangdana/contracts";
import {
  bankAccounts,
  campaigners,
  campaigns,
  db,
  disbursementRequests,
  type disbursementStatusEnum,
  donations,
} from "@galangdana/db";
import { moneyToJSON } from "@galangdana/money";
import { MockPaymentProvider } from "@galangdana/payments";
import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { requestOtp, verifyOtp } from "../auth/otp";
import { checkAdmin } from "../lib/admin";
import { extractDocumentExtension, privateDocumentsS3 } from "../lib/media-s3";
import { sessionDerive } from "../lib/session";

// createPayout() below never reads serverKey (only createCharge/parseWebhook
// do), but this still fails closed rather than falling back to a
// publicly-known literal: MockPaymentProvider is a stand-in for a real
// payment provider, and requiring real configuration before any of its
// methods run in production is the safer default regardless of which
// specific method happens to need which specific field today.
const SERVER_KEY = process.env.MOCK_MIDTRANS_SERVER_KEY ?? "";
function getProvider() {
  if (!SERVER_KEY) {
    throw new Error("MOCK_MIDTRANS_SERVER_KEY is not configured");
  }
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}

/**
 * withdrawable = collectedAmount - totalPlatformFees(paid donations) -
 * disbursedAmount - pendingDisbursementsAmount(otp_pending|requested|
 * approved). Distinct from displayAmount() in packages/db/schema/
 * campaigns.ts, which is the PUBLIC "Donasi tersedia" figure
 * (collectedAmount - disbursedAmount only) and is never changed by this
 * plan. This is the server-side gate for how much a NEW disbursement
 * request may ask for.
 */
export async function computeWithdrawableAmount(campaignId: string): Promise<bigint> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return 0n;

  const [feesRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${donations.platformFee}), 0)` })
    .from(donations)
    .where(and(eq(donations.campaignId, campaignId), eq(donations.status, "paid")));
  const totalFees = BigInt(feesRow?.total ?? "0");

  const [pendingRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${disbursementRequests.amount}), 0)` })
    .from(disbursementRequests)
    .where(
      and(
        eq(disbursementRequests.campaignId, campaignId),
        sql`${disbursementRequests.status} IN ('otp_pending', 'requested', 'approved')`,
      ),
    );
  const pending = BigInt(pendingRow?.total ?? "0");

  return campaign.collectedAmount - totalFees - campaign.disbursedAmount - pending;
}

async function findOwnedCampaignForDisbursement(campaignId: string, userId: string) {
  const [campaigner] = await db
    .select({ id: campaigners.id })
    .from(campaigners)
    .where(eq(campaigners.userId, userId));
  if (!campaigner) return null;
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.campaignerId, campaigner.id)));
  return campaign ?? null;
}

async function findOwnedDisbursement(disbursementId: string, userId: string) {
  const [row] = await db
    .select({
      disbursement: disbursementRequests,
      campaign: campaigns,
      campaignerId: campaigners.id,
    })
    .from(disbursementRequests)
    .innerJoin(campaigns, eq(disbursementRequests.campaignId, campaigns.id))
    .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
    .where(and(eq(disbursementRequests.id, disbursementId), eq(campaigners.userId, userId)));
  return row ?? null;
}

export const disbursementsRoute = new Elysia()
  .use(sessionDerive)
  .post(
    "/campaigns/:id/disbursements",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaignForDisbursement(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "active") {
        set.status = 409;
        return { error: "campaign_not_active" };
      }
      const [row] = await db
        .insert(disbursementRequests)
        .values({ campaignId: campaign.id })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: just inserted
      return { id: row!.id };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: CreateDisbursementResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
  .patch(
    "/disbursements/:id/bank-account",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      const [bankAccount] = await db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.id, body.bankAccountId));
      if (!bankAccount || bankAccount.campaignerId !== row.campaignerId) {
        set.status = 422;
        return { error: "bank_account_not_found" };
      }
      // Guarded on status = 'draft' directly in the UPDATE (not a prior
      // SELECT-then-check) so a concurrent request -- or a race against
      // Task 7's OTP-verify transition -- can never both pass a stale
      // check and both write; only the request that actually observes the
      // row as still `draft` at write time gets to apply its change.
      const updated = await db
        .update(disbursementRequests)
        .set({ bankAccountId: bankAccount.id, updatedAt: new Date() })
        .where(
          and(
            eq(disbursementRequests.id, row.disbursement.id),
            eq(disbursementRequests.status, "draft"),
          ),
        )
        .returning();
      if (updated.length === 0) {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveDisbursementBankAccountBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
  .patch(
    "/disbursements/:id/detail",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      const amount = BigInt(body.amountStr);
      if (amount <= 0n) {
        set.status = 422;
        return { error: "invalid_amount" };
      }
      const withdrawable = await computeWithdrawableAmount(row.campaign.id);
      if (amount > withdrawable) {
        set.status = 422;
        return { error: "amount_exceeds_withdrawable_balance" };
      }
      // See the bank-account handler above for why this is a guarded
      // UPDATE (status = 'draft' in the WHERE, checked via .returning())
      // rather than a prior SELECT-then-check.
      const updated = await db
        .update(disbursementRequests)
        .set({
          type: body.type,
          amount,
          currency: row.campaign.currency,
          narrative: body.narrative,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(disbursementRequests.id, row.disbursement.id),
            eq(disbursementRequests.status, "draft"),
          ),
        )
        .returning();
      if (updated.length === 0) {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveDisbursementDetailBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/disbursements/:id/proof/presign",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      const ext = extractDocumentExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }
      const objectKey = `disbursements/${row.disbursement.id}/proof/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = privateDocumentsS3
        .file(objectKey)
        .presign({ method: "PUT", expiresIn: expiresInSeconds });
      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String() }),
      body: PresignDisbursementProofBodySchema,
      response: {
        200: PresignDisbursementProofResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/disbursements/:id/proof/confirm",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (!body.objectKey.startsWith(`disbursements/${row.disbursement.id}/proof/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }
      // See the bank-account handler above for why this is a guarded
      // UPDATE (status = 'draft' in the WHERE, checked via .returning())
      // rather than a prior SELECT-then-check.
      const updated = await db
        .update(disbursementRequests)
        .set({ proofObjectKey: body.objectKey, updatedAt: new Date() })
        .where(
          and(
            eq(disbursementRequests.id, row.disbursement.id),
            eq(disbursementRequests.status, "draft"),
          ),
        )
        .returning();
      if (updated.length === 0) {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: ConfirmDisbursementProofBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        400: DisbursementErrorSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
  .get(
    "/disbursements/:id",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      const withdrawable = await computeWithdrawableAmount(row.campaign.id);
      return {
        id: row.disbursement.id,
        campaignId: row.campaign.id,
        bankAccountId: row.disbursement.bankAccountId,
        type: row.disbursement.type,
        amount: row.disbursement.amount
          ? moneyToJSON({ amount: row.disbursement.amount, currency: row.campaign.currency })
          : null,
        narrative: row.disbursement.narrative,
        proofObjectKey: row.disbursement.proofObjectKey,
        status: row.disbursement.status,
        otpVerifiedAt: row.disbursement.otpVerifiedAt?.toISOString() ?? null,
        rejectedReason: row.disbursement.rejectedReason,
        payoutRef: row.disbursement.payoutRef,
        paidAt: row.disbursement.paidAt?.toISOString() ?? null,
        withdrawableAmount: moneyToJSON({ amount: withdrawable, currency: row.campaign.currency }),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: DisbursementDetailSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/disbursements/:id/otp/request",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      if (
        !row.disbursement.bankAccountId ||
        !row.disbursement.amount ||
        !row.disbursement.type ||
        !row.disbursement.proofObjectKey
      ) {
        set.status = 422;
        return { error: "disbursement_incomplete" };
      }
      // Re-check the withdrawable balance here, immediately before the
      // transition that reserves funds against the pool. The detail-save
      // check (PATCH .../detail) only holds at save time -- a campaigner
      // can save the full withdrawable amount on two separate drafts (each
      // correctly excluded from computeWithdrawableAmount while still
      // `draft`), then walk both through this route. This disbursement is
      // still `draft` here, so its own amount is not yet counted in the
      // pending sum -- no self-subtraction needed.
      const withdrawable = await computeWithdrawableAmount(row.campaign.id);
      if (row.disbursement.amount > withdrawable) {
        set.status = 422;
        return { error: "amount_exceeds_withdrawable_balance" };
      }
      if (!user.phone) {
        set.status = 422;
        return { error: "no_phone_on_file" };
      }
      const otpResult = await requestOtp(user.phone, "disbursement");
      if (!otpResult.sent) {
        set.status = 422;
        return { error: otpResult.reason ?? "otp_send_failed" };
      }
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "otp_pending", updatedAt: new Date() })
        .where(
          and(
            eq(disbursementRequests.id, row.disbursement.id),
            eq(disbursementRequests.status, "draft"),
          ),
        )
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      return { sent: true };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: RequestDisbursementOtpResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/disbursements/:id/otp/verify",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "otp_pending") {
        set.status = 409;
        return { error: "otp_not_requested" };
      }
      if (!user.phone) {
        set.status = 422;
        return { error: "no_phone_on_file" };
      }
      const result = await verifyOtp(user.phone, body.code, "disbursement");
      if (!result.success) {
        set.status = 422;
        return { error: result.reason ?? "otp_verification_failed" };
      }
      await db
        .update(disbursementRequests)
        .set({ otpVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(disbursementRequests.id, row.disbursement.id));
      return { verified: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: VerifyDisbursementOtpBodySchema,
      response: {
        200: VerifyDisbursementOtpResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/disbursements/:id/submit",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "otp_pending" || !row.disbursement.otpVerifiedAt) {
        set.status = 409;
        return { error: "otp_not_verified" };
      }
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "requested", updatedAt: new Date() })
        .where(
          and(
            eq(disbursementRequests.id, row.disbursement.id),
            eq(disbursementRequests.status, "otp_pending"),
          ),
        )
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "otp_not_verified" };
      }
      return { status: "requested" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
  .get(
    "/admin/disbursements",
    async ({ user, query, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const status = (query.status ??
        "requested") as (typeof disbursementStatusEnum.enumValues)[number];
      const rows = await db
        .select({
          id: disbursementRequests.id,
          campaignId: campaigns.id,
          campaignTitle: campaigns.title,
          type: disbursementRequests.type,
          amount: disbursementRequests.amount,
          currency: disbursementRequests.currency,
          status: disbursementRequests.status,
          createdAt: disbursementRequests.createdAt,
        })
        .from(disbursementRequests)
        .innerJoin(campaigns, eq(disbursementRequests.campaignId, campaigns.id))
        .where(eq(disbursementRequests.status, status))
        .orderBy(desc(disbursementRequests.createdAt));
      return {
        disbursements: rows.map((row) => ({
          id: row.id,
          campaignId: row.campaignId,
          campaignTitle: row.campaignTitle,
          type: row.type,
          amount: moneyToJSON({ amount: row.amount ?? 0n, currency: row.currency ?? "IDR" }),
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
    {
      query: t.Object({ status: t.Optional(t.String()) }),
      response: {
        200: AdminDisbursementListResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
      },
    },
  )
  .get(
    "/admin/disbursements/:id",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const [row] = await db
        .select({
          disbursement: disbursementRequests,
          campaign: campaigns,
          bankAccount: bankAccounts,
        })
        .from(disbursementRequests)
        .innerJoin(campaigns, eq(disbursementRequests.campaignId, campaigns.id))
        .leftJoin(bankAccounts, eq(disbursementRequests.bankAccountId, bankAccounts.id))
        .where(eq(disbursementRequests.id, params.id));
      if (!row || !row.bankAccount) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      const proofViewUrl = row.disbursement.proofObjectKey
        ? privateDocumentsS3
            .file(row.disbursement.proofObjectKey)
            .presign({ method: "GET", expiresIn: 300 })
        : null;
      return {
        id: row.disbursement.id,
        campaignId: row.campaign.id,
        campaignTitle: row.campaign.title,
        bankAccount: {
          bankName: row.bankAccount.bankName,
          accountNumber: row.bankAccount.accountNumber,
          accountHolderName: row.bankAccount.accountHolderName,
          verifiedAt: row.bankAccount.verifiedAt?.toISOString() ?? null,
        },
        type: row.disbursement.type,
        amount: moneyToJSON({
          amount: row.disbursement.amount ?? 0n,
          currency: row.disbursement.currency ?? "IDR",
        }),
        narrative: row.disbursement.narrative ?? "",
        proofViewUrl,
        status: row.disbursement.status,
        createdAt: row.disbursement.createdAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AdminDisbursementDetailSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/admin/disbursements/:id/approve",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const now = new Date();
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "approved", approvedBy: user?.id, approvedAt: now, updatedAt: now })
        .where(
          and(eq(disbursementRequests.id, params.id), eq(disbursementRequests.status, "requested")),
        )
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }
      return { status: "approved" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/admin/disbursements/:id/reject",
    async ({ user, params, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "rejected", rejectedReason: body.reason, updatedAt: new Date() })
        .where(
          and(eq(disbursementRequests.id, params.id), eq(disbursementRequests.status, "requested")),
        )
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }
      return { status: "rejected" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      body: AdminRejectDisbursementBodySchema,
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/admin/disbursements/:id/pay",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const [row] = await db
        .select({ disbursement: disbursementRequests, bankAccount: bankAccounts })
        .from(disbursementRequests)
        .leftJoin(bankAccounts, eq(disbursementRequests.bankAccountId, bankAccounts.id))
        .where(eq(disbursementRequests.id, params.id));
      if (
        !row ||
        row.disbursement.status !== "approved" ||
        !row.bankAccount ||
        !row.disbursement.amount
      ) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }

      const provider = getProvider();
      // Field names match what Task 4 actually shipped (packages/payments/src/types.ts),
      // NOT this plan's own original sketch -- Task 4's research found Xendit's real API
      // uses referenceId/channelCode (Payouts API v2), not externalId/bankCode (the
      // deprecated Disbursement API this plan's earlier draft assumed). channelCode is
      // set directly from bank_accounts.bankCode (e.g. "bca") even though Xendit's real
      // channelCode format differs (e.g. "ID_BCA") -- a known, deliberate simplification
      // Task 4 flagged: the mock never validates this value's format, and mapping it
      // correctly is a real adapter's problem, out of this slice's scope entirely.
      const payout = await provider.createPayout({
        referenceId: row.disbursement.id,
        amount: row.disbursement.amount,
        channelCode: row.bankAccount.bankCode,
        accountNumber: row.bankAccount.accountNumber,
        accountHolderName: row.bankAccount.accountHolderName,
        description: row.disbursement.narrative ?? "",
      });

      const now = new Date();
      const transitioned = await db.transaction(async (tx) => {
        const updated = await tx
          .update(disbursementRequests)
          .set({ status: "paid", payoutRef: payout.payoutId, paidAt: now, updatedAt: now })
          .where(
            and(
              eq(disbursementRequests.id, row.disbursement.id),
              eq(disbursementRequests.status, "approved"),
            ),
          )
          .returning();
        if (updated.length === 0) {
          return false;
        }
        await tx
          .update(campaigns)
          .set({ disbursedAmount: sql`${campaigns.disbursedAmount} + ${row.disbursement.amount}` })
          .where(eq(campaigns.id, row.disbursement.campaignId));
        return true;
      });

      if (!transitioned) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }
      return { status: "paid" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  );
