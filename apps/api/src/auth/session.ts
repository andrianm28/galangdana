import { db, sessions, users } from "@galangdana/db";
import type { Session, User } from "@galangdana/db";
import { and, eq, gt } from "drizzle-orm";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
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
    id: token,
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
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));

  if (!row) return null;
  return { user: row.user, session: row.session };
}

export async function revokeSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}
