import { describe, expect, test } from "bun:test";
import { db } from "../client";
import { users } from "../schema/users";

describe("users", () => {
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
