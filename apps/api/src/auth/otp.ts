import { db, otpChallenges, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { normalizePhone } from "./normalize";
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
  reason?: "invalid_phone" | "rate_limited";
  retryAfterSeconds?: number;
}

export async function requestOtp(
  phone: string,
  smsProvider: SmsProvider = new ConsoleSmsProvider(),
): Promise<RequestOtpResult> {
  // Normalized BEFORE rate-limiting and BEFORE the DB write: without
  // this, "+62811...", "0811...", and "62811..." are three different
  // Redis keys and three different `otp_challenges`/`users` rows for the
  // SAME handset, so the 3/hour cap is bypassable just by respelling the
  // number -- reproduced empirically in the final whole-branch review
  // (12 accepted sends across 4 spellings of one number against a limit
  // of 3).
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { sent: false, reason: "invalid_phone" };
  }

  const rateLimit = await checkOtpRateLimit(normalized);
  if (!rateLimit.allowed) {
    return {
      sent: false,
      reason: "rate_limited",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  const code = generateOtpCode();
  const codeHash = await Bun.password.hash(code, { algorithm: "argon2id" });

  await db.insert(otpChallenges).values({
    phone: normalized,
    codeHash,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await smsProvider.sendOtp(normalized, code);
  return { sent: true };
}

export interface VerifyOtpResult {
  success: boolean;
  user?: User;
  reason?:
    | "invalid_phone"
    | "not_found"
    | "expired"
    | "too_many_attempts"
    | "incorrect_code"
    | "already_used";
}

export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { success: false, reason: "invalid_phone" };
  }

  // Must be the LATEST unconsumed challenge, not an arbitrary/oldest one:
  // a user who taps "resend code" now has two outstanding rows, and
  // without desc() here an ascending order-by would keep checking the
  // superseded first code -- which would also increment ITS attempts
  // counter on every wrong guess with the (correct) new code, eventually
  // locking the user out with a correct code in hand until the old
  // challenge's TTL expires.
  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phone, normalized), isNull(otpChallenges.consumedAt)))
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

  // Claim the attempt slot in the SAME statement that checks the cap, not
  // a SELECT-then-compare with an atomic increment tacked on afterward:
  // the final whole-branch review proved that shape lets unlimited
  // concurrent guesses past MAX_VERIFY_ATTEMPTS, because every concurrent
  // request reads the same pre-increment `attempts` value before any of
  // them writes (40 concurrent wrong guesses all reached
  // Bun.password.verify, none blocked, against a cap of 5). This
  // UPDATE...RETURNING only returns a row when the guard conditions (not
  // consumed, under the cap) hold AT THE MOMENT OF THE WRITE -- a
  // concurrent guess that loses the race gets back no row and is
  // rejected, with no window between check and increment for a second
  // request to sneak through. Note this counts the FINAL successful
  // attempt too, not just wrong guesses (a deliberate simplification:
  // "attempts" now means "verify calls consumed against this challenge,"
  // capped at 5 total -- the row is consumed immediately after a success
  // anyway, so this doesn't change the cap's real-world effect).
  const [claimed] = await db
    .update(otpChallenges)
    .set({ attempts: sql`${otpChallenges.attempts} + 1` })
    .where(
      and(
        eq(otpChallenges.id, challenge.id),
        isNull(otpChallenges.consumedAt),
        lt(otpChallenges.attempts, MAX_VERIFY_ATTEMPTS),
      ),
    )
    .returning();

  if (!claimed) {
    return { success: false, reason: "too_many_attempts" };
  }

  const isValid = await Bun.password.verify(code, claimed.codeHash);
  if (!isValid) {
    return { success: false, reason: "incorrect_code" };
  }

  // Claim consumedAt the same way, for the same reason: two concurrent
  // verifications with the SAME correct code both previously read
  // consumedAt IS NULL before either wrote it, so both succeeded and
  // minted a session -- proven empirically (Promise.all of two identical
  // verifyOtp calls both returned success: true). This UPDATE only
  // returns a row for whichever request wins the race; the loser gets
  // "already_used" instead of a second session.
  const [consumed] = await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpChallenges.id, claimed.id), isNull(otpChallenges.consumedAt)))
    .returning();

  if (!consumed) {
    return { success: false, reason: "already_used" };
  }

  // Atomic find-or-create via INSERT ... ON CONFLICT, not a separate
  // SELECT followed by a conditional INSERT: two concurrent successful
  // verifications for the same brand-new phone number could otherwise
  // both see "no existing user" and both attempt to insert, and the
  // loser would throw on the users.phone unique constraint instead of
  // returning the winner's row. onConflictDoUpdate (a no-op-ish update)
  // makes this one atomic statement that always returns exactly one row,
  // verified empirically: two concurrent calls with the same phone return
  // the same user id.
  const [created] = await db
    .insert(users)
    .values({ phone: normalized })
    .onConflictDoUpdate({ target: users.phone, set: { updatedAt: new Date() } })
    .returning();
  return { success: true, user: created };
}
