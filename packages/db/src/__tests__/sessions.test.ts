import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { sessions } from "../schema/sessions";
import { users } from "../schema/users";

// Same persistent-local-Postgres idempotency concern as users.test.ts.
// Deleting the users cascades to delete their sessions too (FK
// onDelete: "cascade"), so cleaning up by phone is sufficient.
const TEST_PHONES = ["+6281100000010", "+6281100000011"];

describe("sessions", () => {
  beforeAll(async () => {
    await db.delete(users).where(inArray(users.phone, TEST_PHONES));
  });

  test("a session references a real user and expires in the future", async () => {
    const [user] = await db.insert(users).values({ phone: "+6281100000010" }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [session] = await db
      .insert(sessions)
      .values({ id: "test-session-token-1", userId, expiresAt })
      .returning();

    expect(session?.id).toBe("test-session-token-1");
    expect(session?.userId).toBe(userId);
    expect(session?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  test("deleting a user cascades to delete their sessions", async () => {
    const [user] = await db.insert(users).values({ phone: "+6281100000011" }).returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const userId = user!.id;
    await db.insert(sessions).values({
      id: "test-session-token-2",
      userId,
      expiresAt: new Date(Date.now() + 1000),
    });

    await db.delete(users).where(eq(users.id, userId));

    const remaining = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, "test-session-token-2"));
    expect(remaining.length).toBe(0);
  });
});
