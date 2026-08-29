import { beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { db } from "../client";
import { oauthAccounts } from "../schema/oauth-accounts";
import { users } from "../schema/users";

// Same persistent-local-Postgres idempotency concern as users.test.ts and
// sessions.test.ts: these users are created with fixed, unique emails.
// Deleting the users cascades to delete their oauth_accounts rows too (FK
// onDelete: "cascade"), so cleaning up by email is sufficient.
const TEST_EMAILS = ["test-oauth-1@example.test", "test-oauth-2@example.test"];

describe("oauth_accounts", () => {
  beforeAll(async () => {
    await db.delete(users).where(inArray(users.email, TEST_EMAILS));
  });

  test("links a Google account to a user", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "test-oauth-1@example.test" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const [row] = await db
      .insert(oauthAccounts)
      .values({ userId, provider: "google", providerAccountId: "google-sub-test-1" })
      .returning();
    expect(row?.provider).toBe("google");
    expect(row?.providerAccountId).toBe("google-sub-test-1");
  });

  test("the same provider account cannot be linked twice", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: "test-oauth-2@example.test" })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    await db
      .insert(oauthAccounts)
      .values({ userId, provider: "google", providerAccountId: "google-sub-test-2" });

    await expect(
      Promise.resolve(
        db
          .insert(oauthAccounts)
          .values({ userId, provider: "google", providerAccountId: "google-sub-test-2" }),
      ),
    ).rejects.toThrow(/unique/i);
  });
});
