import { redis } from "../lib/redis-client";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limit on an arbitrary key. INCR on a fresh key
 * returns 1, at which point we set the window's expiry -- the standard
 * Redis fixed-window counter pattern, avoiding a separate EXISTS check
 * (INCR creates the key at 0 then increments atomically if it didn't
 * exist). Generalized (not phone-specific) so the same primitive
 * rate-limits OTP requests, login attempts, and registration attempts,
 * each with its own key prefix, cap, and window.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > max) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

const MAX_OTP_REQUESTS_PER_WINDOW = 3;
const OTP_WINDOW_SECONDS = 60 * 60; // 1 hour

export async function checkOtpRateLimit(phone: string): Promise<RateLimitResult> {
  return checkRateLimit(`otp:ratelimit:${phone}`, MAX_OTP_REQUESTS_PER_WINDOW, OTP_WINDOW_SECONDS);
}

const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 10;
const MAX_REGISTER_ATTEMPTS_PER_WINDOW = 5;
const AUTH_WINDOW_SECONDS = 60 * 60; // 1 hour

// Keyed on the normalized email, not IP: this endpoint has no reliable
// client IP yet (no reverse-proxy header handling exists in this repo),
// and the goal here is bounding argon2id cost per *target account* under
// an unauthenticated hash-DoS, which an email key already achieves.
export async function checkLoginRateLimit(email: string): Promise<RateLimitResult> {
  return checkRateLimit(
    `login:ratelimit:${email}`,
    MAX_LOGIN_ATTEMPTS_PER_WINDOW,
    AUTH_WINDOW_SECONDS,
  );
}

export async function checkRegisterRateLimit(email: string): Promise<RateLimitResult> {
  return checkRateLimit(
    `register:ratelimit:${email}`,
    MAX_REGISTER_ATTEMPTS_PER_WINDOW,
    AUTH_WINDOW_SECONDS,
  );
}
