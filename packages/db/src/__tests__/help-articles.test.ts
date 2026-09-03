import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { helpArticles } from "../schema/help-articles";

describe("help_articles", () => {
  beforeAll(async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "test-cara-berdonasi"));
  });

  afterEach(async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "test-cara-berdonasi"));
  });

  test("an article can be created with a unique slug", async () => {
    const [article] = await db
      .insert(helpArticles)
      .values({
        slug: "test-cara-berdonasi",
        question: "Bagaimana cara berdonasi?",
        answer: "Pilih campaign, tentukan nominal, lalu pilih metode pembayaran.",
      })
      .returning();
    expect(article?.question).toBe("Bagaimana cara berdonasi?");
    expect(article?.createdAt).toBeInstanceOf(Date);
  });

  test("slug must be unique across articles", async () => {
    await db.insert(helpArticles).values({
      slug: "test-cara-berdonasi",
      question: "Q1",
      answer: "A1",
    });
    await expect(
      Promise.resolve(
        db.insert(helpArticles).values({
          slug: "test-cara-berdonasi",
          question: "Q2",
          answer: "A2",
        }),
      ),
    ).rejects.toThrow(/unique/i);
  });
});
