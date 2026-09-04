import { beforeAll, describe, expect, test } from "bun:test";
import { bankAccounts, campaigners, db, sessions, users } from "@galangdana/db";
import { eq, inArray } from "drizzle-orm";
import { bankAccountsRoute } from "./bank-accounts";

const app = bankAccountsRoute;

const TEST_USER_ID = "44444444-5555-6666-7777-aaaaaaaaaa01";
const BARE_USER_ID = "44444444-5555-6666-7777-aaaaaaaaaa02";
const TEST_TOKEN = "bank-accounts-test-token";
const BARE_TOKEN = "bank-accounts-bare-token";

let testCampaignerId: string;

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `session=${token}` } });
}

beforeAll(async () => {
  await db.delete(users).where(inArray(users.id, [TEST_USER_ID, BARE_USER_ID]));
  await db.insert(users).values([
    { id: TEST_USER_ID, phone: "+6281199990501" },
    { id: BARE_USER_ID, phone: "+6281199990502" },
  ]);
  await db.insert(sessions).values([
    { id: TEST_TOKEN, userId: TEST_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: BARE_TOKEN, userId: BARE_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  ]);
  const [campaigner] = await db
    .insert(campaigners)
    .values({
      type: "individual",
      displayName: "Bank Accounts Test Campaigner",
      userId: TEST_USER_ID,
    })
    .returning();
  if (!campaigner) throw new Error("campaigner insert failed");
  testCampaignerId = campaigner.id;
});

describe("bank accounts", () => {
  test("POST /bank-accounts requires a campaigner profile", async () => {
    const res = await app.handle(
      authedRequest("http://localhost/bank-accounts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bankCode: "bca",
          bankName: "Bank Central Asia",
          accountNumber: "1234567890",
          accountHolderName: "Test",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBeTruthy();
    const [row] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, body.id));
    expect(row?.campaignerId).toBe(testCampaignerId);
  });

  test("POST /bank-accounts 422s when the user has no campaigner profile", async () => {
    const res = await app.handle(
      authedRequest("http://localhost/bank-accounts", BARE_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bankCode: "bca",
          bankName: "Bank Central Asia",
          accountNumber: "1234567890",
          accountHolderName: "Test",
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_campaigner_profile");
  });

  test("POST /bank-accounts with no session returns 401", async () => {
    const res = await app.handle(
      new Request("http://localhost/bank-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bankCode: "bca",
          bankName: "Bank Central Asia",
          accountNumber: "1234567890",
          accountHolderName: "Test",
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("GET /bank-accounts returns only the authenticated campaigner's own accounts", async () => {
    const [ownRow] = await db
      .insert(bankAccounts)
      .values({
        campaignerId: testCampaignerId,
        bankCode: "bni",
        bankName: "Bank Negara Indonesia",
        accountNumber: "555000111",
        accountHolderName: "Test Owner",
      })
      .returning();
    if (!ownRow) throw new Error("own bank account insert failed");

    // A second, unrelated user+campaigner+bank account, to prove GET
    // scopes strictly to the authenticated campaigner and never leaks
    // another campaigner's rows.
    const otherUserId = crypto.randomUUID();
    const otherToken = `bank-accounts-other-token-${otherUserId}`;
    const otherPhone = `+62811${Math.floor(Math.random() * 1e8)
      .toString()
      .padStart(8, "0")}`;
    await db.insert(users).values({ id: otherUserId, phone: otherPhone });
    await db.insert(sessions).values({
      id: otherToken,
      userId: otherUserId,
      expiresAt: new Date(Date.now() + 86400000),
    });
    const [otherCampaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Other Campaigner", userId: otherUserId })
      .returning();
    if (!otherCampaigner) throw new Error("other campaigner insert failed");
    const [otherRow] = await db
      .insert(bankAccounts)
      .values({
        campaignerId: otherCampaigner.id,
        bankCode: "mandiri",
        bankName: "Bank Mandiri",
        accountNumber: "999888777",
        accountHolderName: "Other Owner",
      })
      .returning();
    if (!otherRow) throw new Error("other bank account insert failed");

    const res = await app.handle(authedRequest("http://localhost/bank-accounts", TEST_TOKEN));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bankAccounts: { id: string }[] };
    const ids = body.bankAccounts.map((a) => a.id);
    expect(ids).toContain(ownRow.id);
    expect(ids).not.toContain(otherRow.id);
  });

  test("GET /bank-accounts with no session returns 401", async () => {
    const res = await app.handle(new Request("http://localhost/bank-accounts"));
    expect(res.status).toBe(401);
  });
});
