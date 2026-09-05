import {
  BankAccountListResponseSchema,
  CreateBankAccountBodySchema,
  DisbursementErrorSchema,
} from "@fundforindonesia/contracts";
import { bankAccounts, campaigners, db } from "@fundforindonesia/db";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

async function findOwnCampaigner(userId: string) {
  const [campaigner] = await db.select().from(campaigners).where(eq(campaigners.userId, userId));
  return campaigner ?? null;
}

export const bankAccountsRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/bank-accounts",
    async ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaigner = await findOwnCampaigner(user.id);
      if (!campaigner) {
        return { bankAccounts: [] };
      }
      const rows = await db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.campaignerId, campaigner.id));
      return {
        bankAccounts: rows.map((row) => ({
          id: row.id,
          bankCode: row.bankCode,
          bankName: row.bankName,
          accountNumber: row.accountNumber,
          accountHolderName: row.accountHolderName,
          verifiedAt: row.verifiedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      response: { 200: BankAccountListResponseSchema, 401: DisbursementErrorSchema },
    },
  )
  .post(
    "/bank-accounts",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaigner = await findOwnCampaigner(user.id);
      if (!campaigner) {
        set.status = 422;
        return { error: "no_campaigner_profile" };
      }
      const [row] = await db
        .insert(bankAccounts)
        .values({
          campaignerId: campaigner.id,
          bankCode: body.bankCode,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountHolderName: body.accountHolderName,
        })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: just inserted
      return { id: row!.id };
    },
    {
      body: CreateBankAccountBodySchema,
      response: {
        200: t.Object({ id: t.String() }),
        401: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  );
