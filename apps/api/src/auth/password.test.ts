import { beforeEach, describe, expect, test } from "bun:test";
import { db, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { redis } from "../lib/redis-client";
import { loginWithEmail, registerWithEmail } from "./password";

const TEST_EMAIL = "test-password-1@example.test";

/**
 * Both auth entry points are now rate-limited per normalized email against
 * a 1-hour fixed window in Redis (5 registers, 10 logins). With fixed test
 * emails and no cleanup, counts accumulate across runs -- and this suite
 * alone already spends most of the register budget on TEST_EMAIL in a
 * single pass -- so a re-run within the hour would flip a genuinely valid
 * call into `rate_limited`. Same test-idempotency reasoning as the
 * `otp:ratelimit:` cleanup in otp.test.ts.
 */
async function clearAuthRateLimits(email: string) {
  await redis.del(`register:ratelimit:${email}`);
  await redis.del(`login:ratelimit:${email}`);
}

describe("registerWithEmail / loginWithEmail", () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, TEST_EMAIL));
    await clearAuthRateLimits(TEST_EMAIL);
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
    await clearAuthRateLimits(phoneOnlyEmail);
    await db.insert(users).values({ phone: "+6281199999301", email: phoneOnlyEmail });

    const result = await loginWithEmail(phoneOnlyEmail, "any-password");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
    await db.delete(users).where(eq(users.email, phoneOnlyEmail));
  });
});

describe("email normalization (case-insensitive identity)", () => {
  // Deliberately mixed case with a leading capital, exactly as the final
  // whole-branch review's probe: "Case.Probe@Example.test" and
  // "case.probe@example.test" registered as two separate accounts, and a
  // mixed-case local account then failed to link with Google's lowercased
  // email assertion.
  const MIXED = "Case.Probe@Example.test";
  const LOWER = "case.probe@example.test";

  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, LOWER));
    await db.delete(users).where(eq(users.email, MIXED));
    await clearAuthRateLimits(LOWER);
    await clearAuthRateLimits(MIXED);
  });

  test("an account registered with mixed case is stored lowercased", async () => {
    const result = await registerWithEmail(MIXED, "correct-horse-battery-staple", "Case Probe");
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe(LOWER);
  });

  test("logging in with a different casing than registration succeeds", async () => {
    await registerWithEmail(MIXED, "correct-horse-battery-staple", "Case Probe");
    const result = await loginWithEmail(LOWER, "correct-horse-battery-staple");
    expect(result.success).toBe(true);
    expect(result.user?.email).toBe(LOWER);
  });

  test("re-registering with either casing is rejected as email_taken, not a second account", async () => {
    await registerWithEmail(MIXED, "first-password-123", "First");

    const sameCasing = await registerWithEmail(MIXED, "second-password-456", "Second");
    expect(sameCasing.success).toBe(false);
    expect(sameCasing.reason).toBe("email_taken");

    const otherCasing = await registerWithEmail(LOWER, "third-password-789", "Third");
    expect(otherCasing.success).toBe(false);
    expect(otherCasing.reason).toBe("email_taken");

    // The decisive assertion: exactly ONE row exists for this identity.
    const rows = await db.select().from(users).where(eq(users.email, LOWER));
    expect(rows.length).toBe(1);
  });
});

describe("auth rate limiting (argon2id hash-DoS bound)", () => {
  const RL_REGISTER_EMAIL = "test-password-rl-register@example.test";
  const RL_LOGIN_EMAIL = "test-password-rl-login@example.test";

  beforeEach(async () => {
    await db.delete(users).where(eq(users.email, RL_REGISTER_EMAIL));
    await db.delete(users).where(eq(users.email, RL_LOGIN_EMAIL));
    await clearAuthRateLimits(RL_REGISTER_EMAIL);
    await clearAuthRateLimits(RL_LOGIN_EMAIL);
  });

  test("registration is capped at 5 attempts per email per window", async () => {
    // The first call succeeds and the next four fail on `email_taken`, but
    // all five consume the budget: the point of the fix is that the cap is
    // spent (and checked BEFORE hashing) regardless of outcome, so a
    // doomed-to-fail request can't be used as an unbounded argon2id
    // amplifier.
    const first = await registerWithEmail(RL_REGISTER_EMAIL, "correct-horse-battery-staple");
    expect(first.success).toBe(true);

    for (let i = 0; i < 4; i++) {
      const taken = await registerWithEmail(RL_REGISTER_EMAIL, "correct-horse-battery-staple");
      expect(taken.success).toBe(false);
      expect(taken.reason).toBe("email_taken");
    }

    const sixth = await registerWithEmail(RL_REGISTER_EMAIL, "correct-horse-battery-staple");
    expect(sixth.success).toBe(false);
    expect(sixth.reason).toBe("rate_limited");
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("login is capped at 10 attempts per email per window", async () => {
    await registerWithEmail(RL_LOGIN_EMAIL, "correct-horse-battery-staple");

    for (let i = 0; i < 10; i++) {
      const attempt = await loginWithEmail(RL_LOGIN_EMAIL, "wrong-password");
      expect(attempt.success).toBe(false);
      expect(attempt.reason).toBe("invalid_credentials");
    }

    const eleventh = await loginWithEmail(RL_LOGIN_EMAIL, "wrong-password");
    expect(eleventh.success).toBe(false);
    expect(eleventh.reason).toBe("rate_limited");
    expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);

    // Even the CORRECT password is refused once the window is spent --
    // confirming the cap is enforced ahead of the hash comparison, not
    // merely reported after it.
    const correct = await loginWithEmail(RL_LOGIN_EMAIL, "correct-horse-battery-staple");
    expect(correct.success).toBe(false);
    expect(correct.reason).toBe("rate_limited");
  });

  test("the login budget is keyed on the NORMALIZED email, so casing can't reset it", async () => {
    for (let i = 0; i < 10; i++) {
      await loginWithEmail(RL_LOGIN_EMAIL, "whatever");
    }
    const respelled = await loginWithEmail(RL_LOGIN_EMAIL.toUpperCase(), "whatever");
    expect(respelled.success).toBe(false);
    expect(respelled.reason).toBe("rate_limited");
  });
});
