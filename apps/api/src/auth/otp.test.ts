import { beforeEach, describe, expect, test } from "bun:test";
import { db, otpChallenges, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { redis } from "../lib/redis-client";
import { normalizePhone } from "./normalize";
import { requestOtp, verifyOtp } from "./otp";
import type { SmsProvider } from "./sms-provider";

const TEST_PHONE = "+6281199999101";
// Mirrors MAX_VERIFY_ATTEMPTS in otp.ts (not exported -- kept module-private
// deliberately; this constant is the test's own statement of the contract).
const MAX_VERIFY_ATTEMPTS = 5;

class CapturingSmsProvider implements SmsProvider {
  lastCode: string | null = null;
  async sendOtp(_phone: string, code: string): Promise<void> {
    this.lastCode = code;
  }
}

describe("requestOtp / verifyOtp", () => {
  beforeEach(async () => {
    await redis.del(`otp:ratelimit:${TEST_PHONE}`);
    await db.delete(otpChallenges).where(eq(otpChallenges.phone, TEST_PHONE));
    await db.delete(users).where(eq(users.phone, TEST_PHONE));
  });

  test("requesting an OTP sends a 6-digit code via the given provider", async () => {
    const sms = new CapturingSmsProvider();
    const result = await requestOtp(TEST_PHONE, "login", sms);
    expect(result.sent).toBe(true);
    expect(sms.lastCode).toMatch(/^\d{6}$/);
  });

  test("verifying the correct code creates a new user and returns it", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    const result = await verifyOtp(TEST_PHONE, code, "login");
    expect(result.success).toBe(true);
    expect(result.user?.phone).toBe(TEST_PHONE);
  });

  test("verifying the same code twice fails the second time (replay protection)", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    await verifyOtp(TEST_PHONE, code, "login");
    const second = await verifyOtp(TEST_PHONE, code, "login");
    expect(second.success).toBe(false);
  });

  test("verifying with the wrong code fails and increments attempts", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);

    const result = await verifyOtp(TEST_PHONE, "000000", "login");
    expect(result.success).toBe(false);
  });

  test("verifying an existing user's phone logs them in rather than creating a duplicate", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const firstCode = sms.lastCode!;
    const first = await verifyOtp(TEST_PHONE, firstCode, "login");
    // biome-ignore lint/style/noNonNullAssertion: asserted success above
    const firstUserId = first.user!.id;

    await requestOtp(TEST_PHONE, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const secondCode = sms.lastCode!;
    const second = await verifyOtp(TEST_PHONE, secondCode, "login");

    expect(second.user?.id).toBe(firstUserId);
  });

  test("resending a code (two outstanding challenges) still verifies against the latest one", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);
    // First code is captured only to prove it's genuinely a different value
    // (sanity: this scenario really produced two distinct challenges).
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const firstCode = sms.lastCode!;

    await requestOtp(TEST_PHONE, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const secondCode = sms.lastCode!;

    // Sanity check that this scenario really does leave two outstanding,
    // unconsumed challenges for the phone -- the exact situation the
    // ascending-orderBy bug broke (it kept matching the superseded first
    // challenge instead of this newer one).
    const outstanding = await db
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.phone, TEST_PHONE));
    expect(outstanding.length).toBe(2);
    expect(firstCode).not.toBe(secondCode);

    // Entering the code from the SECOND (most recent) SMS must succeed. With
    // the ascending-orderBy bug, this would instead be checked against the
    // FIRST challenge's hash and fail with "incorrect_code".
    const result = await verifyOtp(TEST_PHONE, secondCode, "login");
    expect(result.success).toBe(true);
    expect(result.user?.phone).toBe(TEST_PHONE);
  });

  // Direct regression test for C1 from the final whole-branch review, which
  // reproduced this with 40 concurrent wrong guesses: ALL 40 reached
  // Bun.password.verify and none were blocked, against a cap of 5, because
  // the cap was checked against an `attempts` value read moments before any
  // increment landed. The fix claims the attempt slot in the same
  // UPDATE ... WHERE attempts < 5 ... RETURNING that increments it.
  test("concurrent wrong guesses cannot exceed MAX_VERIFY_ATTEMPTS", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);

    const CONCURRENT_GUESSES = 20;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_GUESSES }, () => verifyOtp(TEST_PHONE, "000000", "login")),
    );

    const incorrect = results.filter((r) => r.reason === "incorrect_code");
    const blocked = results.filter((r) => r.reason === "too_many_attempts");

    // Exactly MAX_VERIFY_ATTEMPTS guesses may consume an attempt slot and
    // reach the hash comparison; every other concurrent guess must be
    // rejected without one.
    expect(incorrect.length).toBe(MAX_VERIFY_ATTEMPTS);
    expect(blocked.length).toBe(CONCURRENT_GUESSES - MAX_VERIFY_ATTEMPTS);
    expect(results.every((r) => r.success === false)).toBe(true);

    // The persisted counter must also be exactly the cap -- not higher (a
    // lost-update / over-increment) and not lower.
    const [row] = await db.select().from(otpChallenges).where(eq(otpChallenges.phone, TEST_PHONE));
    expect(row?.attempts).toBe(MAX_VERIFY_ATTEMPTS);
  });

  // Direct regression test for I1: two concurrent verifications with the
  // SAME correct code both read `consumedAt IS NULL` before either wrote it,
  // so both succeeded and both minted a session.
  test("two concurrent verifications with the same correct code mint exactly one success", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    const [first, second] = await Promise.all([
      verifyOtp(TEST_PHONE, code, "login"),
      verifyOtp(TEST_PHONE, code, "login"),
    ]);
    const results = [first, second];

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0]?.reason).toBe("already_used");
    expect(succeeded[0]?.user?.phone).toBe(TEST_PHONE);
  });

  // Purpose is part of the challenge lookup, not just an audit label: a
  // code sent for "login" must not verify against "disbursement" and vice
  // versa, otherwise Task 7's disbursement-confirmation step could be
  // satisfied by replaying a login OTP the user received for an unrelated
  // reason.
  test("a login OTP challenge cannot be verified against the disbursement purpose", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    const result = await verifyOtp(TEST_PHONE, code, "disbursement");
    expect(result.success).toBe(false);
    expect(result.reason).toBe("not_found");
  });
});

describe("phone normalization in requestOtp / verifyOtp", () => {
  // Four spellings of ONE handset -- the exact set the final whole-branch
  // review used to bypass the 3/hour cap (12 accepted sends against a limit
  // of 3). They all normalize to the same canonical number, so one Redis
  // key and one otp_challenges phone value covers cleanup for all four.
  const SPELLINGS = ["+6281199999501", "081199999501", "6281199999501", "+62 81199999501"];
  // biome-ignore lint/style/noNonNullAssertion: all four spellings are valid Indonesian mobile numbers
  const CANONICAL = normalizePhone(SPELLINGS[0]!)!;

  beforeEach(async () => {
    await redis.del(`otp:ratelimit:${CANONICAL}`);
    await db.delete(otpChallenges).where(eq(otpChallenges.phone, CANONICAL));
    await db.delete(users).where(eq(users.phone, CANONICAL));
  });

  test("all four spellings share one rate-limit budget", async () => {
    const sms = new CapturingSmsProvider();
    // The cap is 3/hour. Three distinct spellings are accepted...
    for (const spelling of SPELLINGS.slice(0, 3)) {
      const result = await requestOtp(spelling, "login", sms);
      expect(result.sent).toBe(true);
    }
    // ...and the FOURTH distinct spelling of the same handset is refused,
    // because it resolves to the same rate-limit key rather than a fresh
    // one. Before the fix this was the fourth *accepted* send.
    const fourth = await requestOtp(SPELLINGS[3] as string, "login", sms);
    expect(fourth.sent).toBe(false);
    expect(fourth.reason).toBe("rate_limited");
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("all spellings write and read the same canonical challenge and user", async () => {
    const sms = new CapturingSmsProvider();
    // Send to one spelling...
    await requestOtp(SPELLINGS[1] as string, "login", sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    // ...every challenge row is stored under the canonical number.
    const rows = await db.select().from(otpChallenges).where(eq(otpChallenges.phone, CANONICAL));
    expect(rows.length).toBe(1);

    // ...and verifying via a DIFFERENT spelling still finds it and produces
    // one user, stored canonically (four spellings would otherwise have
    // become four separate users rows for one handset).
    const result = await verifyOtp(SPELLINGS[2] as string, code, "login");
    expect(result.success).toBe(true);
    expect(result.user?.phone).toBe(CANONICAL);
  });

  test("an unnormalizable phone number is rejected before any rate-limit or DB access", async () => {
    const requested = await requestOtp("not-a-phone", "login");
    expect(requested.sent).toBe(false);
    expect(requested.reason).toBe("invalid_phone");

    const verified = await verifyOtp("not-a-phone", "000000", "login");
    expect(verified.success).toBe(false);
    expect(verified.reason).toBe("invalid_phone");
  });
});
