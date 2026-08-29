import { redis } from "../lib/redis-client";

const MAX_OTP_REQUESTS_PER_WINDOW = 3;
const WINDOW_SECONDS = 60 * 60; // 1 hour

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limit on OTP requests, keyed per phone number. INCR
 * on a fresh key returns 1, at which point we set the window's expiry —
 * this is the standard Redis fixed-window counter pattern and avoids a
 * separate EXISTS check (INCR creates the key at 0 then increments
 * atomically if it didn't exist).
 */
export async function checkOtpRateLimit(phone: string): Promise<RateLimitResult> {
  const key = `otp:ratelimit:${phone}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }
  if (count > MAX_OTP_REQUESTS_PER_WINDOW) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
