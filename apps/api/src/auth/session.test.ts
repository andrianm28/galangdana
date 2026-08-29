import { beforeEach, describe, expect, test } from "bun:test";
import { db, sessions, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { createSession, revokeSession, validateSession } from "./session";

const TEST_PHONE = "+6281199999201";

describe("session lifecycle", () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.phone, TEST_PHONE));
  });

  test("createSession issues a random token tied to the user, valid for ~30 days", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const { token, expiresAt } = await createSession(userId);
    expect(token.length).toBeGreaterThanOrEqual(32);
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(29);
    expect(daysUntilExpiry).toBeLessThan(31);
  });

  test("two sessions for the same user get different tokens", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const a = await createSession(userId);
    const b = await createSession(userId);
    expect(a.token).not.toBe(b.token);
  });

  test("validateSession returns the user for a valid token", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    const { token } = await createSession(userId);

    const result = await validateSession(token);
    expect(result?.user.id).toBe(userId);
  });

  test("validateSession returns null for an unknown token", async () => {
    const result = await validateSession("this-token-does-not-exist");
    expect(result).toBeNull();
  });

  test("validateSession returns null for an expired session", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    await db.insert(sessions).values({
      id: "expired-test-token",
      userId,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await validateSession("expired-test-token");
    expect(result).toBeNull();
  });

  test("revokeSession deletes the session so it no longer validates", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    const { token } = await createSession(userId);

    await revokeSession(token);
    const result = await validateSession(token);
    expect(result).toBeNull();
  });
});
