import { beforeEach, describe, expect, test } from "bun:test";
import { redis } from "../lib/redis-client";
import { checkLoginRateLimit, checkOtpRateLimit, checkRegisterRateLimit } from "./rate-limit";

const TEST_PHONE = "+6281199999001";
const TEST_LOGIN_EMAIL = "test-ratelimit-login@example.test";
const TEST_REGISTER_EMAIL = "test-ratelimit-register@example.test";

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

describe("checkLoginRateLimit", () => {
  beforeEach(async () => {
    await redis.del(`login:ratelimit:${TEST_LOGIN_EMAIL}`);
  });

  test("allows attempts up to the limit", async () => {
    for (let i = 0; i < 10; i++) {
      const result = await checkLoginRateLimit(TEST_LOGIN_EMAIL);
      expect(result.allowed).toBe(true);
    }
  });

  test("blocks the attempt after the limit is exceeded", async () => {
    for (let i = 0; i < 10; i++) {
      await checkLoginRateLimit(TEST_LOGIN_EMAIL);
    }
    const eleventh = await checkLoginRateLimit(TEST_LOGIN_EMAIL);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("rate limits are scoped per email", async () => {
    const otherEmail = "test-ratelimit-login-other@example.test";
    await redis.del(`login:ratelimit:${otherEmail}`);
    for (let i = 0; i < 11; i++) {
      await checkLoginRateLimit(TEST_LOGIN_EMAIL);
    }
    const otherResult = await checkLoginRateLimit(otherEmail);
    expect(otherResult.allowed).toBe(true);
    await redis.del(`login:ratelimit:${otherEmail}`);
  });

  test("login and register budgets are independent key spaces", async () => {
    // Same email string, different prefix -- exhausting one must not
    // consume the other's budget.
    await redis.del(`register:ratelimit:${TEST_LOGIN_EMAIL}`);
    for (let i = 0; i < 11; i++) {
      await checkLoginRateLimit(TEST_LOGIN_EMAIL);
    }
    const registerResult = await checkRegisterRateLimit(TEST_LOGIN_EMAIL);
    expect(registerResult.allowed).toBe(true);
    await redis.del(`register:ratelimit:${TEST_LOGIN_EMAIL}`);
  });
});

describe("checkRegisterRateLimit", () => {
  beforeEach(async () => {
    await redis.del(`register:ratelimit:${TEST_REGISTER_EMAIL}`);
  });

  test("allows attempts up to the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await checkRegisterRateLimit(TEST_REGISTER_EMAIL);
      expect(result.allowed).toBe(true);
    }
  });

  test("blocks the attempt after the limit is exceeded", async () => {
    for (let i = 0; i < 5; i++) {
      await checkRegisterRateLimit(TEST_REGISTER_EMAIL);
    }
    const sixth = await checkRegisterRateLimit(TEST_REGISTER_EMAIL);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("rate limits are scoped per email", async () => {
    const otherEmail = "test-ratelimit-register-other@example.test";
    await redis.del(`register:ratelimit:${otherEmail}`);
    for (let i = 0; i < 6; i++) {
      await checkRegisterRateLimit(TEST_REGISTER_EMAIL);
    }
    const otherResult = await checkRegisterRateLimit(otherEmail);
    expect(otherResult.allowed).toBe(true);
    await redis.del(`register:ratelimit:${otherEmail}`);
  });
});
