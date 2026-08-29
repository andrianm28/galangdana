import { db, otpChallenges, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { checkOtpRateLimit } from "./rate-limit";
import { ConsoleSmsProvider, type SmsProvider } from "./sms-provider";

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function generateOtpCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // biome-ignore lint/style/noNonNullAssertion: array has length 1
  return String(array[0]! % 1_000_000).padStart(6, "0");
}

export interface RequestOtpResult {
  sent: boolean;
  retryAfterSeconds?: number;
}

export async function requestOtp(
  phone: string,
  smsProvider: SmsProvider = new ConsoleSmsProvider(),
): Promise<RequestOtpResult> {
  const rateLimit = await checkOtpRateLimit(phone);
  if (!rateLimit.allowed) {
    return { sent: false, retryAfterSeconds: rateLimit.retryAfterSeconds };
  }

  const code = generateOtpCode();
  const codeHash = await Bun.password.hash(code, { algorithm: "argon2id" });

  await db.insert(otpChallenges).values({
    phone,
    codeHash,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await smsProvider.sendOtp(phone, code);
  return { sent: true };
}

export interface VerifyOtpResult {
  success: boolean;
  user?: User;
  reason?: "not_found" | "expired" | "too_many_attempts" | "incorrect_code";
}

export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  // Must be the LATEST unconsumed challenge, not an arbitrary/oldest one:
  // a user who taps "resend code" now has two outstanding rows, and without
  // desc() here an ascending order-by would keep checking the superseded
  // first code -- which would also increment ITS attempts counter on every
  // wrong guess with the (correct) new code, eventually locking the user
  // out with a correct code in hand until the old challenge's TTL expires.
  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phone, phone), isNull(otpChallenges.consumedAt)))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  if (!challenge) {
    return { success: false, reason: "not_found" };
  }

  // Checked as a separate step (not folded into the query's WHERE via
  // gt(expiresAt, now)) specifically so an expired-but-otherwise-matching
  // challenge returns the precise "expired" reason instead of the less
  // useful "not_found" -- a caller can tell "there was never a code" apart
  // from "there was one, but it's stale, request a new one."
  if (challenge.expiresAt.getTime() <= Date.now()) {
    return { success: false, reason: "expired" };
  }

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { success: false, reason: "too_many_attempts" };
  }

  const isValid = await Bun.password.verify(code, challenge.codeHash);
  if (!isValid) {
    // Atomic increment at the database level (sql`... + 1`), not
    // `challenge.attempts + 1` computed from a value read moments earlier
    // in application code -- two concurrent wrong-code requests reading the
    // same starting value and both writing "+1" would otherwise silently
    // lose an increment, letting an attacker exceed MAX_VERIFY_ATTEMPTS.
    await db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(eq(otpChallenges.id, challenge.id));
    return { success: false, reason: "incorrect_code" };
  }

  await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(otpChallenges.id, challenge.id));

  // Atomic find-or-create via INSERT ... ON CONFLICT, not a separate SELECT
  // followed by a conditional INSERT: two concurrent successful
  // verifications for the same brand-new phone number could otherwise both
  // see "no existing user" and both attempt to insert, and the loser would
  // throw on the users.phone unique constraint instead of returning the
  // winner's row. onConflictDoUpdate (a no-op-ish update) makes this one
  // atomic statement that always returns exactly one row, verified
  // empirically: two concurrent calls with the same phone return the same
  // user id.
  const [created] = await db
    .insert(users)
    .values({ phone })
    .onConflictDoUpdate({ target: users.phone, set: { updatedAt: new Date() } })
    .returning();
  return { success: true, user: created };
}
