import { db, otpChallenges, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { and, eq, gt, isNull } from "drizzle-orm";
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
  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(
      and(
        eq(otpChallenges.phone, phone),
        isNull(otpChallenges.consumedAt),
        gt(otpChallenges.expiresAt, new Date()),
      ),
    )
    .orderBy(otpChallenges.createdAt)
    .limit(1);

  if (!challenge) {
    return { success: false, reason: "not_found" };
  }

  if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { success: false, reason: "too_many_attempts" };
  }

  const isValid = await Bun.password.verify(code, challenge.codeHash);
  if (!isValid) {
    await db
      .update(otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallenges.id, challenge.id));
    return { success: false, reason: "incorrect_code" };
  }

  await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(otpChallenges.id, challenge.id));

  const [existing] = await db.select().from(users).where(eq(users.phone, phone));
  if (existing) {
    return { success: true, user: existing };
  }

  const [created] = await db.insert(users).values({ phone }).returning();
  return { success: true, user: created };
}
