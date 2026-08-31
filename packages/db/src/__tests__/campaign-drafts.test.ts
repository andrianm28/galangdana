import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignDrafts, campaignStoryAnswers } from "../schema/campaign-drafts";
import { campaignCategories } from "../schema/categories";
import { users } from "../schema/users";

const TEST_USER_ID = "11111111-2222-3333-4444-555555555501";
const TEST_PHONE = "+6281199990001";

beforeAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({ id: TEST_USER_ID, phone: TEST_PHONE });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

describe("campaignDrafts", () => {
  test("creates a medical-track draft with default empty answers and a current step", async () => {
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found — run db:seed first");

    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: TEST_USER_ID,
        track: "medical",
        categoryId: category.id,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();

    expect(draft?.track).toBe("medical");
    expect(draft?.currentStep).toBe("info");
    expect(draft?.answers).toEqual({});

    if (draft) await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));
  });

  test("stores arbitrary step answers as jsonb, including a decimal-string goal amount", async () => {
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found — run db:seed first");

    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: TEST_USER_ID,
        track: "non_medical",
        categoryId: category.id,
        answers: { title: "Bantu Renovasi Musala", goalAmountStr: "15000000" },
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();

    expect(draft?.answers).toEqual({
      title: "Bantu Renovasi Musala",
      goalAmountStr: "15000000",
    });

    if (draft) await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));
  });

  test("campaignStoryAnswers: one row per guided question, unique per (draftId, questionNumber)", async () => {
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found — run db:seed first");
    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: TEST_USER_ID,
        track: "medical",
        categoryId: category.id,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");

    await db.insert(campaignStoryAnswers).values([
      { draftId: draft.id, questionNumber: 1, answerText: "Sejak kapan sakit ini dimulai?" },
      { draftId: draft.id, questionNumber: 2, answerText: "Dua bulan lalu." },
    ]);

    const rows = await db
      .select()
      .from(campaignStoryAnswers)
      .where(eq(campaignStoryAnswers.draftId, draft.id));
    expect(rows.length).toBe(2);

    await expect(
      Promise.resolve(
        db.insert(campaignStoryAnswers).values({
          draftId: draft.id,
          questionNumber: 1,
          answerText: "duplicate question number",
        }),
      ),
    ).rejects.toThrow();

    await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id)); // cascades
  });

  test("deleting a draft cascades to its story answers", async () => {
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("no seeded category found — run db:seed first");
    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: TEST_USER_ID,
        track: "medical",
        categoryId: category.id,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");
    await db.insert(campaignStoryAnswers).values({
      draftId: draft.id,
      questionNumber: 1,
      answerText: "answer",
    });

    await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));

    const rows = await db
      .select()
      .from(campaignStoryAnswers)
      .where(eq(campaignStoryAnswers.draftId, draft.id));
    expect(rows.length).toBe(0);
  });
});
