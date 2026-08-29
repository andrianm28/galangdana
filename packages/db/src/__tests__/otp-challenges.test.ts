import { describe, expect, test } from "bun:test";
import { db } from "../client";
import { otpChallenges } from "../schema/otp-challenges";

describe("otp_challenges", () => {
  test("a challenge is created unconsumed with zero attempts", async () => {
    const [row] = await db
      .insert(otpChallenges)
      .values({
        phone: "+6281100000020",
        codeHash: "argon2-hash-placeholder",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .returning();
    expect(row?.attempts).toBe(0);
    expect(row?.consumedAt).toBeNull();
  });

  test("attempts and consumedAt can be updated in place", async () => {
    const [row] = await db
      .insert(otpChallenges)
      .values({
        phone: "+6281100000021",
        codeHash: "argon2-hash-placeholder",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: insert().returning() on a single-row insert always returns that row
    const id = row!.id;

    const now = new Date();
    const { eq } = await import("drizzle-orm");
    const [updated] = await db
      .update(otpChallenges)
      .set({ attempts: 1, consumedAt: now })
      .where(eq(otpChallenges.id, id))
      .returning();
    expect(updated?.attempts).toBe(1);
    expect(updated?.consumedAt?.getTime()).toBe(now.getTime());
  });
});
