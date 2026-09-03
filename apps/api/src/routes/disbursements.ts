import {
  ConfirmDisbursementProofBodySchema,
  CreateDisbursementResponseSchema,
  DisbursementDetailSchema,
  DisbursementErrorSchema,
  PresignDisbursementProofBodySchema,
  PresignDisbursementProofResponseSchema,
  SaveDisbursementBankAccountBodySchema,
  SaveDisbursementDetailBodySchema,
} from "@galangdana/contracts";
import {
  bankAccounts,
  campaigners,
  campaigns,
  db,
  disbursementRequests,
  donations,
} from "@galangdana/db";
import { moneyToJSON } from "@galangdana/money";
import { and, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { extractDocumentExtension, privateDocumentsS3 } from "../lib/media-s3";
import { sessionDerive } from "../lib/session";

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
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      const [bankAccount] = await db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.id, body.bankAccountId));
      if (!bankAccount || bankAccount.campaignerId !== row.campaignerId) {
        set.status = 422;
        return { error: "bank_account_not_found" };
      }
      await db
        .update(disbursementRequests)
        .set({ bankAccountId: bankAccount.id, updatedAt: new Date() })
        .where(eq(disbursementRequests.id, row.disbursement.id));
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
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
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
      await db
        .update(disbursementRequests)
        .set({
          type: body.type,
          amount,
          currency: row.campaign.currency,
          narrative: body.narrative,
          updatedAt: new Date(),
        })
        .where(eq(disbursementRequests.id, row.disbursement.id));
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
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      if (!body.objectKey.startsWith(`disbursements/${row.disbursement.id}/proof/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }
      await db
        .update(disbursementRequests)
        .set({ proofObjectKey: body.objectKey, updatedAt: new Date() })
        .where(eq(disbursementRequests.id, row.disbursement.id));
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
  );
