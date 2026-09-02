import { describe, expect, test } from "bun:test";
import { db, users } from "@galangdana/db";
import { getOrCreateCampaignerForUser } from "./campaigner";

describe("getOrCreateCampaignerForUser", () => {
  test("creates a new individual campaigner row for a user's first submission", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62815${Date.now()}`, name: "Budi Santoso" })
      .returning();
    if (!user) throw new Error("user insert failed");

    const campaigner = await getOrCreateCampaignerForUser(user.id);

    expect(campaigner.userId).toBe(user.id);
    expect(campaigner.type).toBe("individual");
    expect(campaigner.displayName).toBe("Budi Santoso");
    expect(campaigner.verifiedAt).toBeNull();
  });

  test("falls back to a generic display name when the user never set one", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62816${Date.now()}` })
      .returning();
    if (!user) throw new Error("user insert failed");

    const campaigner = await getOrCreateCampaignerForUser(user.id);
    expect(campaigner.displayName).toBe("Penggalang Dana");
  });

  test("returns the SAME campaigner row on a second call for the same user, not a duplicate", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62817${Date.now()}`, name: "Citra Dewi" })
      .returning();
    if (!user) throw new Error("user insert failed");

    const first = await getOrCreateCampaignerForUser(user.id);
    const second = await getOrCreateCampaignerForUser(user.id);
    expect(second.id).toBe(first.id);
  });
});
