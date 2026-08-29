import { beforeEach, describe, expect, test } from "bun:test";
import { db, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { loginWithEmail, registerWithEmail } from "./password";

const TEST_EMAIL = "test-password-1@example.test";

describe("registerWithEmail / loginWithEmail", () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, TEST_EMAIL));
  });

  test("registering creates a user with a hashed (not plaintext) password", async () => {
    const result = await registerWithEmail(TEST_EMAIL, "correct-horse-battery-staple", "Test User");
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe(TEST_EMAIL);
    expect(result.user?.name).toBe("Test User");

    const [row] = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(row?.passwordHash).not.toBe("correct-horse-battery-staple");
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  test("registering with an email that's already taken fails", async () => {
    await registerWithEmail(TEST_EMAIL, "first-password-123", "First");
    const result = await registerWithEmail(TEST_EMAIL, "second-password-456", "Second");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("email_taken");
  });

  test("logging in with the correct password succeeds", async () => {
    await registerWithEmail(TEST_EMAIL, "correct-horse-battery-staple", "Test User");
    const result = await loginWithEmail(TEST_EMAIL, "correct-horse-battery-staple");
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe(TEST_EMAIL);
  });

  test("logging in with the wrong password fails", async () => {
    await registerWithEmail(TEST_EMAIL, "correct-horse-battery-staple", "Test User");
    const result = await loginWithEmail(TEST_EMAIL, "wrong-password");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
  });

  test("logging in with an unknown email fails with the same reason as a wrong password", async () => {
    // Same failure reason for "no such user" and "wrong password" is
    // deliberate: it avoids leaking which emails are registered.
    const result = await loginWithEmail("no-such-user@example.test", "whatever");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
  });

  test("logging in against a phone-only user (no password set) fails cleanly", async () => {
    const phoneOnlyEmail = "test-password-phone-only@example.test";
    await db.delete(users).where(eq(users.email, phoneOnlyEmail));
    await db.insert(users).values({ phone: "+6281199999301", email: phoneOnlyEmail });

    const result = await loginWithEmail(phoneOnlyEmail, "any-password");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
    await db.delete(users).where(eq(users.email, phoneOnlyEmail));
  });
});
