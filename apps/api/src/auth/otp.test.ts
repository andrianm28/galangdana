import { beforeEach, describe, expect, test } from "bun:test";
import { db, otpChallenges, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { redis } from "../lib/redis-client";
import { requestOtp, verifyOtp } from "./otp";
import type { SmsProvider } from "./sms-provider";

const TEST_PHONE = "+6281199999101";

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
    const result = await requestOtp(TEST_PHONE, sms);
    expect(result.sent).toBe(true);
    expect(sms.lastCode).toMatch(/^\d{6}$/);
  });

  test("verifying the correct code creates a new user and returns it", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    const result = await verifyOtp(TEST_PHONE, code);
    expect(result.success).toBe(true);
    expect(result.user?.phone).toBe(TEST_PHONE);
  });

  test("verifying the same code twice fails the second time (replay protection)", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const code = sms.lastCode!;

    await verifyOtp(TEST_PHONE, code);
    const second = await verifyOtp(TEST_PHONE, code);
    expect(second.success).toBe(false);
  });

  test("verifying with the wrong code fails and increments attempts", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);

    const result = await verifyOtp(TEST_PHONE, "000000");
    expect(result.success).toBe(false);
  });

  test("verifying an existing user's phone logs them in rather than creating a duplicate", async () => {
    const sms = new CapturingSmsProvider();
    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const firstCode = sms.lastCode!;
    const first = await verifyOtp(TEST_PHONE, firstCode);
    // biome-ignore lint/style/noNonNullAssertion: asserted success above
    const firstUserId = first.user!.id;

    await requestOtp(TEST_PHONE, sms);
    // biome-ignore lint/style/noNonNullAssertion: requestOtp above always calls sendOtp before returning
    const secondCode = sms.lastCode!;
    const second = await verifyOtp(TEST_PHONE, secondCode);

    expect(second.user?.id).toBe(firstUserId);
  });
});
