import { db, users } from "@galangdana/db";
import type { User } from "@galangdana/db";
import { eq } from "drizzle-orm";

export interface RegisterResult {
  success: boolean;
  user?: User;
  reason?: "email_taken";
}

export async function registerWithEmail(
  email: string,
  password: string,
  name?: string,
): Promise<RegisterResult> {
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });

  // Atomic check-and-insert via ON CONFLICT DO NOTHING, not a separate
  // SELECT-then-INSERT: two concurrent registrations with the same email
  // could otherwise both pass the "not taken" check and both attempt to
  // insert, with the loser throwing an unhandled unique-constraint error
  // instead of cleanly returning "email_taken" -- the exact race class
  // Task 4's user find-or-create had, fixed the same way here before
  // dispatch. onConflictDoNothing means a colliding insert affects zero
  // rows, so RETURNING is empty and `created` is undefined -- a clean,
  // race-free signal that the email was already taken (verified: two
  // sequential inserts with the same email return a real row then
  // undefined).
  const [created] = await db
    .insert(users)
    .values({ email, passwordHash, name })
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
  reason?: "invalid_credentials";
}

export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  const [user] = await db.select().from(users).where(eq(users.email, email));

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
