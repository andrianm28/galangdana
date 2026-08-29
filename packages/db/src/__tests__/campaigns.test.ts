import { beforeAll, describe, expect, test } from "bun:test";
import { money } from "@galangdana/money";
import { inArray } from "drizzle-orm";
import { db } from "../client";
import { campaigns, displayAmount } from "../schema/campaigns";
import { runSeed } from "../seed/run-seed";

// The positive-insert tests below use fixed slugs so they read clearly.
// Unlike categories.test.ts's seed (idempotent via onConflictDoNothing),
// these are plain inserts — re-running this file against the SAME persistent
// local Postgres (not a fresh CI container) would otherwise fail on the
// second run with "duplicate key value violates unique constraint
// campaigns_slug_unique". Delete any leftover rows with these exact slugs
// first so the file is safe to run any number of times locally. The two
// "should fail" (CHECK-violation) tests' slugs are included too: if the
// CHECK constraint were ever accidentally removed, their inserts would
// succeed and leave rows behind, which would then make a *second* run fail
// on the unique slug constraint instead of the CHECK constraint — silently
// masking the regression. Cleaning them up here keeps that failure mode
// from ever being possible.
const TEST_SLUGS = [
  "bantu-warga-kalimantan-test",
  "sumur-bor-masjid-test",
  "invalid-goal-test",
  "invalid-program-test",
];

describe("campaigns dual model", () => {
  // campaigns.category_id has a NOT NULL foreign key into campaign_categories.
  // This test file must not assume categories.test.ts (Task 5) already ran
  // and left rows behind — bun:test's file execution order is not guaranteed
  // to match task order (alphabetically "campaigns.test.ts" sorts BEFORE
  // "categories.test.ts"), and a fresh database has no categories at all.
  // runSeed() is idempotent (onConflictDoNothing), so calling it here is safe
  // regardless of what has or hasn't already run.
  beforeAll(async () => {
    await runSeed();
    await db.delete(campaigns).where(inArray(campaigns.slug, TEST_SLUGS));
  });

  test("a goal-model campaign requires goal_amount and allows expires_at", async () => {
    const [row] = await db
      .insert(campaigns)
      .values({
        slug: "bantu-warga-kalimantan-test",
        title: "Bantu Warga Kalimantan yang Terdampak Karhutla",
        shortDescription: "Uji coba model goal",
        categoryId: 22, // bencana-alam
        model: "goal",
        goalAmount: 3_000_000_000n,
        expiresAt: new Date("2026-12-31T00:00:00Z"),
        collectedAmount: 1_180_879_232n,
      })
      .returning();
    expect(row?.model).toBe("goal");
    expect(row?.goalAmount).toBe(3_000_000_000n);
    // biome-ignore lint/style/noNonNullAssertion: row non-null is already proven by the expect() calls above
    expect(displayAmount(row!)).toEqual(money(1_180_879_232n, "IDR"));
  });

  test("a program-model campaign forbids goal_amount and expires_at", async () => {
    const [row] = await db
      .insert(campaigns)
      .values({
        slug: "sumur-bor-masjid-test",
        title: "Sumur Bor untuk Masjid yang Kekurangan Air",
        shortDescription: "Uji coba model program",
        categoryId: 23, // rumah-ibadah
        model: "program",
        collectedAmount: 128_607_690n,
        disbursedAmount: 7_561_862n,
      })
      .returning();
    expect(row?.model).toBe("program");
    expect(row?.goalAmount).toBeNull();
    expect(row?.expiresAt).toBeNull();
    // "Donasi tersedia" is a live balance, not the cumulative total.
    // biome-ignore lint/style/noNonNullAssertion: row non-null is already proven by the expect() calls above
    expect(displayAmount(row!)).toEqual(money(121_045_828n, "IDR"));
  });

  test("the database rejects a goal-model row with no goal_amount", async () => {
    // Wrapped in Promise.resolve(): drizzle's query builder is thenable but
    // not `instanceof Promise`, and bun:test's `.rejects` matcher requires a
    // native Promise. Promise.resolve() on a thenable adopts its
    // fulfillment/rejection unchanged (per spec) — this is not a behavior
    // change, only what makes bun's strict instanceof check accept it.
    await expect(
      Promise.resolve(
        db.insert(campaigns).values({
          slug: "invalid-goal-test",
          title: "Invalid",
          shortDescription: "Should fail",
          categoryId: 22,
          model: "goal",
          // goalAmount omitted — must violate the check constraint
        }),
      ),
      // Matched against the real Postgres error message, which includes the
      // constraint name. A bare .rejects.toThrow() would also accept an
      // unrelated failure (e.g. the slug's UNIQUE constraint) if the CHECK
      // constraint were ever accidentally removed -- that's the false-green
      // path this specific match closes off.
    ).rejects.toThrow(/goal_model_requires_goal_amount/);
  });

  test("the database rejects a program-model row that carries a goal_amount", async () => {
    await expect(
      Promise.resolve(
        db.insert(campaigns).values({
          slug: "invalid-program-test",
          title: "Invalid",
          shortDescription: "Should fail",
          categoryId: 22,
          model: "program",
          goalAmount: 1_000_000n, // must violate the check constraint
        }),
      ),
    ).rejects.toThrow(/goal_model_requires_goal_amount/);
  });
});
