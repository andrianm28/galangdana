import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { bankAccounts } from "../schema/bank-accounts";
import { campaigners } from "../schema/campaigners";
import { users } from "../schema/users";

describe("bank_accounts", () => {
  let campaignerId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62811${Date.now()}` })
      .returning();
    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test Campaigner", userId: user?.id })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    campaignerId = campaigner!.id;
  });

  afterAll(async () => {
    await db.delete(bankAccounts).where(eq(bankAccounts.campaignerId, campaignerId));
  });

  test("a bank account can be created and defaults verifiedAt to null", async () => {
    const [row] = await db
      .insert(bankAccounts)
      .values({
        campaignerId,
        bankCode: "bca",
        bankName: "Bank Central Asia",
        accountNumber: "1234567890",
        accountHolderName: "Test Campaigner",
      })
      .returning();
    expect(row?.verifiedAt).toBeNull();
    expect(row?.accountNumber).toBe("1234567890");
  });
});
