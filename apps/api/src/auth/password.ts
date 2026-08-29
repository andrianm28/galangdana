import { db, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { normalizeEmail } from "./normalize";
import { checkLoginRateLimit, checkRegisterRateLimit } from "./rate-limit";

export interface RegisterResult {
  success: boolean;
  user?: User;
  reason?: "email_taken" | "rate_limited";
  retryAfterSeconds?: number;
}

export async function registerWithEmail(
  email: string,
  password: string,
  name?: string,
): Promise<RegisterResult> {
  const normalizedEmail = normalizeEmail(email);

  // Rate-limited BEFORE hashing: argon2id costs real CPU/memory per call
  // (~200ms, ~64MiB on the review machine), and this endpoint used to pay
  // that cost even for a request that was always going to fail on a
  // taken email -- an unauthenticated amplification DoS the final
  // whole-branch review flagged. Checking the cap first bounds the cost
  // to 5 hashes/hour per email regardless of outcome.
  const rateLimit = await checkRegisterRateLimit(normalizedEmail);
  if (!rateLimit.allowed) {
    return {
      success: false,
      reason: "rate_limited",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });

  // Atomic check-and-insert via ON CONFLICT DO NOTHING, not a separate
  // SELECT-then-INSERT: two concurrent registrations with the same email
  // could otherwise both pass the "not taken" check and both attempt to
  // insert, with the loser throwing an unhandled unique-constraint error
  // instead of cleanly returning "email_taken" -- the same race class as
  // Task 4's user find-or-create, fixed the same way here.
  // onConflictDoNothing means a colliding insert affects zero rows, so
  // RETURNING is empty and `created` is undefined -- a clean, race-free
  // signal that the email was already taken.
  const [created] = await db
    .insert(users)
    .values({ email: normalizedEmail, passwordHash, name })
    .onConflictDoNothing({ target: users.email })
    .returning();

  if (!created) {
    return { success: false, reason: "email_taken" };
  }
  return { success: true, user: created };
}

export interface LoginResult {
  success: boolean;
  user?: User;
  reason?: "invalid_credentials" | "rate_limited";
  retryAfterSeconds?: number;
}

export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(email);

  const rateLimit = await checkLoginRateLimit(normalizedEmail);
  if (!rateLimit.allowed) {
    return {
      success: false,
      reason: "rate_limited",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail));

  // A missing user and a user with no password set (phone/Google-only)
  // both fail identically to "invalid_credentials" -- neither leaks
  // anything an attacker could use to enumerate accounts.
  if (!user || !user.passwordHash) {
    return { success: false, reason: "invalid_credentials" };
  }

  const isValid = await Bun.password.verify(password, user.passwordHash);
  if (!isValid) {
    return { success: false, reason: "invalid_credentials" };
  }

  return { success: true, user };
}
