import { db, sessions, users } from "@fundforindonesia/db";
import type { Session, User } from "@fundforindonesia/db";
import { and, eq, gt } from "drizzle-orm";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// The sessions table stores only the SHA-256 of the token (as its id), so
// a database read leak yields hashes, not immediately usable credentials.
// Lookup hashes the presented token first -- same 30-day opaque-token flow
// as before, just no plaintext at rest. Side effect of the change: every
// pre-existing session row stops validating on deploy (all users logged
// out once). Acceptable for a pre-launch product; note it in the deploy.
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: await hashSessionToken(token),
    userId,
    expiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });
  return { token, expiresAt };
}

export async function validateSession(
  token: string,
): Promise<{ user: User; session: Session } | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, await hashSessionToken(token)), gt(sessions.expiresAt, new Date())));

  if (!row) return null;
  return { user: row.user, session: row.session };
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, await hashSessionToken(token)));
}
