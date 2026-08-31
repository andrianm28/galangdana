import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { beneficiaries } from "../schema/beneficiaries";
import { campaignDrafts } from "../schema/campaign-drafts";
import { campaignCategories } from "../schema/categories";
import { patients } from "../schema/patients";
import { users } from "../schema/users";

const TEST_USER_ID = "11111111-2222-3333-4444-555555555502";
const TEST_PHONE = "+6281199990002";

async function makeDraft(track: "medical" | "non_medical") {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found — run db:seed first");
  const [draft] = await db
    .insert(campaignDrafts)
    .values({
      userId: TEST_USER_ID,
      track,
      categoryId: category.id,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    })
    .returning();
  if (!draft) throw new Error("draft insert failed");
  return draft;
}

beforeAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({ id: TEST_USER_ID, phone: TEST_PHONE });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID)); // cascades drafts
});

describe("patients", () => {
  test("stores medical patient details for a draft, one row per draft", async () => {
    const draft = await makeDraft("medical");
    const [patient] = await db
      .insert(patients)
      .values({
        draftId: draft.id,
        name: "Aldi",
        age: 2,
        illness: "Kelainan jantung bawaan",
        hospitalName: "RS Harapan Kita",
        relationshipToCampaigner: "anak",
      })
      .returning();

    expect(patient?.name).toBe("Aldi");
    expect(patient?.age).toBe(2);

    await expect(
      Promise.resolve(
        db.insert(patients).values({ draftId: draft.id, name: "Duplicate", illness: "x" }),
      ),
    ).rejects.toThrow();
  });
});

describe("beneficiaries", () => {
  test("stores non-medical beneficiary details for a draft, one row per draft", async () => {
    const draft = await makeDraft("non_medical");
    const [beneficiary] = await db
      .insert(beneficiaries)
      .values({
        draftId: draft.id,
        name: "Warga Desa Sukamaju",
        relationship: "Komunitas",
        needDescription: "Renovasi musala yang rusak akibat banjir.",
      })
      .returning();

    expect(beneficiary?.name).toBe("Warga Desa Sukamaju");

    await expect(
      Promise.resolve(
        db
          .insert(beneficiaries)
          .values({ draftId: draft.id, name: "Duplicate", needDescription: "x" }),
      ),
    ).rejects.toThrow();
  });
});
