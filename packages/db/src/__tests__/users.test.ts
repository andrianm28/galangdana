import { beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { db } from "../client";
import { users } from "../schema/users";

// Fixed test values with no natural uniqueness guard beyond the schema's own
// unique constraints -- re-running this file against the SAME persistent
// local Postgres (not a fresh CI container) would otherwise fail on the
// second run with "duplicate key value violates unique constraint". Same
// pattern as campaigns.test.ts (Phase 0a): delete any leftover rows with
// these exact values first so the file is safe to run any number of times.
const TEST_PHONES = ["+6281100000001", "+6281100000002"];
const TEST_EMAILS = ["test-users-1@example.test", "test-users-2@example.test"];

describe("users", () => {
  beforeAll(async () => {
    await db.delete(users).where(inArray(users.phone, TEST_PHONES));
    await db.delete(users).where(inArray(users.email, TEST_EMAILS));
  });

  test("a user can be created with only a phone number", async () => {
    const [row] = await db.insert(users).values({ phone: "+6281100000001" }).returning();
    expect(row?.phone).toBe("+6281100000001");
    expect(row?.email).toBeNull();
    expect(row?.passwordHash).toBeNull();
    expect(row?.defaultAnonymous).toBe(false);
  });

  test("a user can be created with only an email and password hash", async () => {
    const [row] = await db
      .insert(users)
      .values({ email: "test-users-1@example.test", passwordHash: "argon2-hash-placeholder" })
      .returning();
    expect(row?.email).toBe("test-users-1@example.test");
    expect(row?.phone).toBeNull();
  });

  test("phone must be unique across users", async () => {
    await db.insert(users).values({ phone: "+6281100000002" });
    await expect(
      Promise.resolve(db.insert(users).values({ phone: "+6281100000002" })),
    ).rejects.toThrow(/unique/i);
  });

  test("email must be unique across users", async () => {
    await db.insert(users).values({ email: "test-users-2@example.test" });
    await expect(
      Promise.resolve(db.insert(users).values({ email: "test-users-2@example.test" })),
    ).rejects.toThrow(/unique/i);
  });
});
