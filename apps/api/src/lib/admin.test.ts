import { describe, expect, test } from "bun:test";
import type { User } from "@fundforindonesia/db";
import { checkAdmin } from "./admin";

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    phone: null,
    email: "user@example.test",
    passwordHash: null,
    name: "Test User",
    avatarUrl: null,
    defaultAnonymous: false,
    role: "campaigner",
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("checkAdmin", () => {
  test("returns a 401 error for no user", () => {
    expect(checkAdmin(null)).toEqual({ status: 401 });
  });

  test("returns a 403 error for an authenticated non-admin", () => {
    expect(checkAdmin(fakeUser({ role: "campaigner" }))).toEqual({ status: 403 });
  });

  test("returns null (allowed) for an admin", () => {
    expect(checkAdmin(fakeUser({ role: "admin" }))).toBeNull();
  });
});
