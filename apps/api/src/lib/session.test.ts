import { describe, expect, test } from "bun:test";
import { db, sessions, users } from "@fundforindonesia/db";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { sessionDerive } from "./session";

const TEST_USER_ID = "22222222-3333-4444-5555-666666666601";
const TEST_PHONE = "+6281199990101";
const TEST_TOKEN = "session-derive-test-token";

describe("sessionDerive", () => {
  test("derives a null user when no session cookie is present", async () => {
    const app = new Elysia().use(sessionDerive).get("/whoami", ({ user }) => ({ user }));
    const resp = await app.handle(new Request("http://localhost/whoami"));
    const body = (await resp.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });

  test("derives the real user when a valid session cookie is present", async () => {
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    await db.insert(users).values({ id: TEST_USER_ID, phone: TEST_PHONE });
    await db.insert(sessions).values({
      id: TEST_TOKEN,
      userId: TEST_USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    });

    const app = new Elysia().use(sessionDerive).get("/whoami", ({ user }) => ({ user }));
    const resp = await app.handle(
      new Request("http://localhost/whoami", {
        headers: { cookie: `session=${TEST_TOKEN}` },
      }),
    );
    const body = (await resp.json()) as { user: { id: string } | null };
    expect(body.user?.id).toBe(TEST_USER_ID);

    await db.delete(sessions).where(eq(sessions.id, TEST_TOKEN));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });
});
