import { beforeEach, describe, expect, test } from "bun:test";
import { redis } from "../lib/redis-client";
import { checkOtpRateLimit } from "./rate-limit";

const TEST_PHONE = "+6281199999001";

describe("checkOtpRateLimit", () => {
  beforeEach(async () => {
    await redis.del(`otp:ratelimit:${TEST_PHONE}`);
  });

  test("allows requests up to the limit", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await checkOtpRateLimit(TEST_PHONE);
      expect(result.allowed).toBe(true);
    }
  });

  test("blocks the request after the limit is exceeded", async () => {
    for (let i = 0; i < 3; i++) {
      await checkOtpRateLimit(TEST_PHONE);
    }
    const fourth = await checkOtpRateLimit(TEST_PHONE);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("rate limits are scoped per phone number", async () => {
    const otherPhone = "+6281199999002";
    await redis.del(`otp:ratelimit:${otherPhone}`);
    for (let i = 0; i < 3; i++) {
      await checkOtpRateLimit(TEST_PHONE);
    }
    const otherResult = await checkOtpRateLimit(otherPhone);
    expect(otherResult.allowed).toBe(true);
    await redis.del(`otp:ratelimit:${otherPhone}`);
  });
});
