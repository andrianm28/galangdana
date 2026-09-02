import { describe, expect, test } from "bun:test";
import { db } from "@galangdana/db";
import { campaignCategories, campaigners, campaigns } from "@galangdana/db";
import { RESERVED_SLUGS, generateUniqueSlug } from "./slug";

describe("generateUniqueSlug", () => {
  test("slugifies a title into a URL-safe, lowercase, hyphenated form", async () => {
    const slug = await generateUniqueSlug("Bantu Aldi Sembuh dari Kelainan Jantung!");
    expect(slug).toBe("bantu-aldi-sembuh-dari-kelainan-jantung");
  });

  test("appends a numeric suffix when the base slug is already taken", async () => {
    const [category] = await db
      .select({ id: campaignCategories.id })
      .from(campaignCategories)
      .limit(1);
    if (!category) throw new Error("expected seeded categories for this test");
    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Slug Test Campaigner" })
      .returning();
    if (!campaigner) throw new Error("campaigner insert failed");

    const title = `Unique Slug Title ${Date.now()}`;
    const first = await generateUniqueSlug(title);
    await db.insert(campaigns).values({
      slug: first,
      title,
      shortDescription: "x",
      categoryId: category.id,
      campaignerId: campaigner.id,
      model: "goal",
      goalAmount: 1000000n,
    });

    const second = await generateUniqueSlug(title);
    expect(second).not.toBe(first);
    expect(second.startsWith(first)).toBe(true);
  });

  test("appends a numeric suffix when the base slug collides with a reserved route segment", async () => {
    const slug = await generateUniqueSlug("Explore");
    expect(slug).not.toBe("explore");
    expect(RESERVED_SLUGS.has("explore")).toBe(true);
  });
});
