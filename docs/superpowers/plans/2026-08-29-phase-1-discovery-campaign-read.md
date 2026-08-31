# Phase 1: Discovery + Campaign Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor browse real campaigns — home feed, category explore, campaign detail (both the `goal` and `program` models), and typo-tolerant search — all server-rendered, backed by real seeded data, real images through a signed imgproxy pipeline, and a real Meilisearch index.

**Architecture:** Read-only for this phase — no donation, no campaign creation, no auth-gated pages. `packages/db` gains a minimal `campaigners` table (just enough to attribute and filter campaigns; full verification/onboarding is Phase 5) and campaign fixture data. Two new shared packages, `packages/media` (imgproxy URL signing) and `packages/search` (Meilisearch client + indexing), sit alongside the existing `packages/money`. `apps/api` gains `campaigns` and `search` routes; `apps/web` gains four SSR pages consuming them through the existing Eden Treaty client.

**Tech Stack:** Meilisearch (already provisioned in `docker-compose.yml` from Phase 0a, unused until now), self-hosted `imgproxy` (new to `docker-compose.yml`), `Bun.S3Client` (native, no AWS SDK) against the already-provisioned MinIO service, the official `meilisearch` npm client (`Meilisearch` class — note the casing, verified against the installed version).

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` (Phases section: `1. Discovery + campaign read — SSR home/explore/campaign detail (both models), Meilisearch, imgproxy pipeline`; Module map's Discovery and Campaign rows; Domain model's `campaigners`/`campaigns` tables; Cross-cutting concerns: `Search`, `Image pipeline`)

## Scope

**In scope:** campaigners (minimal, unverified — full KYC is Phase 5), campaign fixture/seed data (both models, multiple categories), campaign list (`/explore/[category]`) with category + type filter and urgent/newest sort, campaign detail (`/campaign/[slug]`, both models rendered distinctly), a home page showing a curated feed plus a category quick-nav strip, typo-tolerant search (`/search`) backed by Meilisearch, and real images through a signed imgproxy pipeline.

**Explicitly out of scope, deferred to the phase that needs it:** donation/checkout (Phase 2), campaign creation (Phase 4), moderation (Phase 5), full campaigner verification/KYC (Phase 5), fundraisers/P2P (part of campaign detail's sub-tabs — deferred), donors/contributors/prayers tabs (Phase 6/9), zakat calculator (Phase 7), the `/search/campaign`, `/search/campaigner`, `/search/results` sub-route split (this phase ships one `/search` results page, not the sub-route tree), a dedicated `/category` all-categories browse page (the home page's category strip covers cross-linking for now), `/lihatsemua/[slug]`, `/product/[...slug]`, `/initiative/[slug]` (CSR/programme-specific, Phase 8).

## Global Constraints

- **The imgproxy signing key never reaches the browser.** `IMGPROXY_KEY`/`IMGPROXY_SALT` are read only by `apps/api` (via `packages/media`). Every campaign API response returns a fully-built, already-signed image URL string — `apps/web`'s `+page.ts` load functions (which run in the browser during hydration and client-side navigation, not just on the server) never import `packages/media` or see the raw key. This is a real, verified risk this plan avoids by construction: a signing secret imported into a `+page.ts` file would ship inside the client-side JS bundle.
- Every campaign-bearing API response encodes money fields via `@galangdana/money`'s `moneyToJSON`/`MoneyJSON` shape (`{ amount: string, currency: "IDR" | "USD" }`), never a raw `bigint` or a plain number — bigints don't survive `JSON.stringify` (Phase 0a's serializer handles the response layer, but contracts still declare the wire shape explicitly) and a plain number silently loses precision above `Number.MAX_SAFE_INTEGER`.
- A campaign's displayed amount always goes through `packages/db`'s existing `displayAmount(campaign)` helper (goal model → `collectedAmount`; program model → `collectedAmount - disbursedAmount`) — never `collectedAmount` read directly for display, which is only correct for the `goal` model.
- Money-column defaults in any new `bigint("...", { mode: "bigint" })` schema field use `sql\`0\`` (a SQL default), never a literal `0n` — Phase 0a already hit `drizzle-kit generate` crashing on `JSON.stringify` of a raw BigInt default; this plan's `campaigners` table has no money columns, but any future addition to this area must follow the same pattern.
- `coverMediaUrl` (existing `campaigns` column, added in Phase 0a) stores a **relative object key** within the media bucket (e.g. `campaigns/covers/banjir-kalsel.jpg`), never a full URL — the full source URL is assembled server-side from a configured base URL plus this key, exactly once, in `packages/media`. This keeps the database free of any infra hostname/port.
- Every component follows Phase 0c's established `packages/ui` conventions: Tailwind utility classes only (no `<style>` blocks), `const` for `$props()` destructuring (this plan introduces no component with a genuinely-reassigned prop, so none needs `let`), barrel-exported from `packages/ui/src/index.ts`, a real `@testing-library/svelte` rendering test per component, and `bun run lint` treated as a mandatory final check on every task even where a task's own verification step doesn't explicitly re-list it.
- SSR pages use `+page.ts` (universal load, matching the existing `(consumer)/+page.ts` pattern) wherever the load function only calls the public read API — never `+page.server.ts` for these, to stay consistent with the one load pattern this codebase has already established, **except** nothing in this plan ever needs `+page.server.ts` since no page here touches a secret.
- **An Eden Treaty query object's key must be omitted entirely for an unset optional filter, never included with an `undefined` value.** Verified empirically against this repo's installed Eden Treaty/Elysia versions: `client.foo.get({ query: { bar: undefined } })` serializes `bar` on the wire as the literal string `"undefined"`, not an absent parameter — which then fails TypeBox validation on any schema declaring that field as a specific literal/enum union (a plain `Type.Optional(Type.String())` would silently accept the bogus string instead, an even worse failure mode). Always build the query object with a conditional spread (`...(value ? { key: value } : {})`), never `key: value ?? undefined`. This plan's Task 11 is the one place it matters today; any later phase adding another optional query filter must do the same.
- New workspace packages (`packages/media`, `packages/search`) follow the established no-build-step, consumed-from-source pattern already used by `packages/money`/`contracts`/`db`/`ui`.

---

## Task 1: `campaigners` table and the `campaigns.campaignerId` foreign key

**Files:**
- Create: `packages/db/src/schema/campaigners.ts`
- Modify: `packages/db/src/schema/campaigns.ts` (add `campaignerId` column + FK)
- Modify: `packages/db/src/schema/index.ts` (barrel export)
- Test: `packages/db/src/__tests__/campaigners.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task of this phase).
- Produces: `campaigners` table and `Campaigner`/`NewCampaigner` types, importable as `import { campaigners, campaignerTypeEnum } from "@galangdana/db";`. `campaigns.campaignerId: uuid, notNull, references campaigners.id`.

- [ ] **Step 1: Write the failing test — `packages/db/src/__tests__/campaigners.test.ts`**

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";

// Same persistent-local-Postgres idempotency concern established in every
// earlier phase's tests: delete fixture rows by their fixed values first.
const TEST_NAMES = ["Test Campaigner Individual", "Test Campaigner Yayasan", "Test Campaigner Platform"];

describe("campaigners", () => {
  beforeAll(async () => {
    await db.delete(campaigners).where(inArray(campaigners.displayName, TEST_NAMES));
  });

  test("a campaigner can be created with each type", async () => {
    const [individual] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test Campaigner Individual" })
      .returning();
    const [yayasan] = await db
      .insert(campaigners)
      .values({ type: "yayasan", displayName: "Test Campaigner Yayasan" })
      .returning();
    const [platform] = await db
      .insert(campaigners)
      .values({ type: "platform", displayName: "Test Campaigner Platform" })
      .returning();

    expect(individual?.type).toBe("individual");
    expect(yayasan?.type).toBe("yayasan");
    expect(platform?.type).toBe("platform");
    expect(individual?.verifiedAt).toBeNull();
  });

  test("a campaign requires a valid campaignerId -- inserting with a nonexistent one fails", async () => {
    const [category] = await db.select().from(campaignCategories).limit(1);
    if (!category) throw new Error("expected campaign_categories to already be seeded");

    await expect(
      db.insert(campaigns).values({
        slug: "test-campaigners-fk-violation",
        title: "FK violation test",
        shortDescription: "should not insert",
        categoryId: category.id,
        campaignerId: "00000000-0000-0000-0000-000000000000",
        model: "program",
      }),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/campaigners.test.ts`
Expected: FAIL — `Cannot find module '../schema/campaigners'` (or the `campaignerId` column doesn't exist yet on `campaigns`).

- [ ] **Step 3: Implement `packages/db/src/schema/campaigners.ts`**

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Deliberately minimal for this phase: enough to attribute a campaign to
// someone and support the explore page's Kitabisa/Yayasan/Publik-style
// type filter. No verification workflow, no KYC documents, no bank
// account, no auth linkage (an individual campaigner is NOT the same row
// as a `users` account yet) -- all of that is Phase 5's job. verifiedAt
// exists now because the column is cheap and campaign detail pages will
// want a "verified" badge before Phase 5 ships the flow that actually
// sets it; it stays NULL for every fixture in this phase.
export const campaignerTypeEnum = pgEnum("campaigner_type", ["individual", "yayasan", "platform"]);

export const campaigners = pgTable("campaigners", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: campaignerTypeEnum("type").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Campaigner = typeof campaigners.$inferSelect;
export type NewCampaigner = typeof campaigners.$inferInsert;
```

- [ ] **Step 4: Add the FK to `packages/db/src/schema/campaigns.ts`**

Add the import:

```ts
import { campaigners } from "./campaigners";
```

Add the column immediately after `categoryId` (before the `currency` column):

```ts
    categoryId: integer("category_id")
      .notNull()
      .references(() => campaignCategories.id),

    campaignerId: uuid("campaigner_id")
      .notNull()
      .references(() => campaigners.id),

    // Every money-bearing table in this platform carries an explicit
```

(The comment above `currency` that follows stays exactly as it already is — this only inserts the new column between `categoryId` and the existing `currency` field, it does not touch any other line in the file.)

- [ ] **Step 5: Update the barrel — `packages/db/src/schema/index.ts`**

```ts
export * from "./categories";
export * from "./campaigners";
export * from "./campaigns";
export * from "./users";
export * from "./sessions";
export * from "./otp-challenges";
export * from "./oauth-accounts";
```

- [ ] **Step 6: Generate and inspect the migration**

Run: `cd packages/db && bun run db:generate`
Expected: a new migration file creating the `campaigner_type` enum and `campaigners` table, and an `ALTER TABLE campaigns ADD COLUMN campaigner_id uuid NOT NULL REFERENCES campaigners(id)`. Read the generated SQL file and confirm it matches this description before proceeding — a `NOT NULL` column added to a table with existing rows would fail in an environment where `campaigns` already has data; confirm via `psql`/a quick script that the local dev `campaigns` table is currently empty (it should be, since this plan's own Task 2 is what first seeds it) so the migration applies cleanly.

- [ ] **Step 7: Apply the migration**

Run: `cd packages/db && bun run db:migrate`
Expected: succeeds with no errors.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/campaigners.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 9: Run the full `packages/db` suite and typecheck**

Run: `cd packages/db && bun test && bun run typecheck`
Expected: all existing tests still pass (this task only adds a table and a required column with no default — confirm no other test in this package inserts a `campaigns` row without `campaignerId` and now fails; if one does, it is this task's job to fix that test's fixture data, not to weaken the new constraint).

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): add campaigners table and campaigns.campaignerId FK"
```

---

## Task 2: Campaign and campaigner fixture/seed data

**Files:**
- Create: `packages/db/src/seed/campaigners.seed.ts`
- Create: `packages/db/src/seed/campaigns.seed.ts`
- Modify: `packages/db/src/seed/run-seed.ts`
- Test: `packages/db/src/__tests__/seed-data.test.ts`

**Interfaces:**
- Consumes: `campaigners`, `campaigns`, `campaignCategories` from Task 1 / existing schema.
- Produces: `CAMPAIGNER_SEED_DATA`, `CAMPAIGN_SEED_DATA` exported arrays (consumed only by the seed script and this task's own test — no later task imports these directly, later tasks query the database instead). After `bun run db:seed`, the database has 5 campaigners and 8 published, active campaigns spanning both models and 6 different categories.

- [ ] **Step 1: Write the failing test — `packages/db/src/__tests__/seed-data.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { CAMPAIGNER_SEED_DATA } from "../seed/campaigners.seed";
import { CAMPAIGN_SEED_DATA } from "../seed/campaigns.seed";

describe("seed fixture data", () => {
  test("every campaign references a campaigner that exists in the campaigner seed data", () => {
    const campaignerNames = new Set(CAMPAIGNER_SEED_DATA.map((c) => c.displayName));
    for (const campaign of CAMPAIGN_SEED_DATA) {
      expect(campaignerNames.has(campaign.campaignerName)).toBe(true);
    }
  });

  test("every goal-model campaign has a goalAmount and an expiresAt; every program-model campaign has neither", () => {
    for (const campaign of CAMPAIGN_SEED_DATA) {
      if (campaign.model === "goal") {
        expect(campaign.goalAmount).not.toBeNull();
        expect(campaign.expiresAt).not.toBeNull();
      } else {
        expect(campaign.goalAmount).toBeNull();
        expect(campaign.expiresAt).toBeNull();
      }
    }
  });

  test("at least one campaign of each model exists, spanning at least 4 distinct categories", () => {
    const models = new Set(CAMPAIGN_SEED_DATA.map((c) => c.model));
    const categories = new Set(CAMPAIGN_SEED_DATA.map((c) => c.categorySlug));
    expect(models.has("goal")).toBe(true);
    expect(models.has("program")).toBe(true);
    expect(categories.size).toBeGreaterThanOrEqual(4);
  });

  test("every campaign slug is unique", () => {
    const slugs = CAMPAIGN_SEED_DATA.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
```

This test file uses `vitest` (not `bun:test`) since it imports plain TS data with no DB access and this package's `bun:test`-based tests all touch a real database — actually, on reflection, this test needs **no DB and no Vitest-specific API**, so keep it on `bun:test` for consistency with every other test in `packages/db` (there is no reason to introduce a second test runner into this package). Rewrite the import line only:

```ts
import { beforeAll, describe, expect, test } from "bun:test";
```

(`beforeAll` is unused here since this test touches no database state — omit it from the import if your editor/linter flags unused imports; the corrected import line is simply `import { describe, expect, test } from "bun:test";`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/seed-data.test.ts`
Expected: FAIL — `Cannot find module '../seed/campaigners.seed'`.

- [ ] **Step 3: Implement `packages/db/src/seed/campaigners.seed.ts`**

```ts
import type { NewCampaigner } from "../schema/campaigners";

export const CAMPAIGNER_SEED_DATA: NewCampaigner[] = [
  { type: "individual", displayName: "Budi Santoso" },
  { type: "individual", displayName: "Rina Wijaya" },
  { type: "yayasan", displayName: "Yayasan Peduli Sesama" },
  { type: "yayasan", displayName: "Yayasan Bina Umat Sejahtera" },
  { type: "platform", displayName: "GalangDana Program Mitra" },
];
```

- [ ] **Step 4: Implement `packages/db/src/seed/campaigns.seed.ts`**

`categorySlug`/`campaignerName` are resolved to real foreign-key ids by the seed script (Step 5) — they exist here only so this fixture data doesn't have to hardcode ids that depend on insert order.

```ts
export interface CampaignSeedRow {
  slug: string;
  title: string;
  shortDescription: string;
  story: string;
  coverMediaUrl: string;
  categorySlug: string;
  campaignerName: string;
  model: "goal" | "program";
  goalAmount: bigint | null;
  expiresAt: Date | null;
  collectedAmount: bigint;
  disbursedAmount: bigint;
  donationCount: number;
}

// expiresAt values are computed relative to a fixed reference date rather
// than `new Date()` so this file's own describe-what-you-see comments
// ("closes in ~3 weeks") stay accurate regardless of when `bun run
// db:seed` actually runs -- see run-seed.ts for how these get finalized.
const DAY_MS = 24 * 60 * 60 * 1000;

export const CAMPAIGN_SEED_DATA: CampaignSeedRow[] = [
  {
    slug: "bantu-korban-banjir-bandang-kalimantan-selatan",
    title: "Bantu Korban Banjir Bandang di Kalimantan Selatan",
    shortDescription:
      "Ratusan keluarga kehilangan tempat tinggal akibat banjir bandang. Bantu mereka mendapatkan kebutuhan darurat.",
    story:
      "Banjir bandang yang melanda beberapa desa di Kalimantan Selatan telah memaksa ratusan keluarga mengungsi. Dana yang terkumpul akan disalurkan untuk logistik darurat, tempat tinggal sementara, dan kebutuhan sanitasi bagi para pengungsi.",
    coverMediaUrl: "campaigns/covers/banjir-kalimantan-selatan.jpg",
    categorySlug: "bencana-alam",
    campaignerName: "Yayasan Peduli Sesama",
    model: "goal",
    goalAmount: 500_000_000n,
    expiresAt: new Date(Date.now() + 21 * DAY_MS), // closes in ~3 weeks
    collectedAmount: 312_500_000n,
    disbursedAmount: 0n,
    donationCount: 1284,
  },
  {
    slug: "uluran-tangan-untuk-aldi-kelainan-jantung",
    title: "Uluran Tangan untuk Aldi, Balita Penderita Kelainan Jantung Bawaan",
    shortDescription:
      "Aldi (2 tahun) membutuhkan operasi jantung segera. Keluarganya tidak mampu menanggung biaya operasi.",
    story:
      "Aldi didiagnosis kelainan jantung bawaan sejak lahir dan membutuhkan tindakan operasi secepatnya. Biaya yang dibutuhkan jauh di luar kemampuan keluarganya. Setiap donasi akan langsung disalurkan ke rumah sakit tempat Aldi dirawat.",
    coverMediaUrl: "campaigns/covers/aldi-kelainan-jantung.jpg",
    categorySlug: "balita-anak-sakit",
    campaignerName: "Rina Wijaya",
    model: "goal",
    goalAmount: 250_000_000n,
    expiresAt: new Date(Date.now() + 45 * DAY_MS),
    collectedAmount: 74_800_000n,
    disbursedAmount: 0n,
    donationCount: 512,
  },
  {
    slug: "renovasi-musala-al-ikhlas",
    title: "Renovasi Musala Al-Ikhlas yang Rusak Parah",
    shortDescription:
      "Atap musala bocor dan lantai retak sejak lama. Warga sekitar ingin merenovasinya agar layak dipakai kembali.",
    story:
      "Musala Al-Ikhlas telah berdiri lebih dari 20 tahun dan menjadi pusat kegiatan ibadah warga sekitar. Kondisinya kini memprihatinkan: atap bocor saat hujan dan lantai mulai retak. Dana akan digunakan untuk perbaikan atap, lantai, dan fasilitas wudu.",
    coverMediaUrl: "campaigns/covers/renovasi-musala-al-ikhlas.jpg",
    categorySlug: "rumah-ibadah",
    campaignerName: "Budi Santoso",
    model: "goal",
    goalAmount: 80_000_000n,
    expiresAt: new Date(Date.now() + 14 * DAY_MS),
    collectedAmount: 71_200_000n,
    disbursedAmount: 0n,
    donationCount: 340,
  },
  {
    slug: "program-amil-zakat-mitra",
    title: "Dana Zakat untuk Program Amil Mitra GalangDana",
    shortDescription:
      "Salurkan zakat Anda melalui amil mitra terpercaya untuk didistribusikan kepada mustahik secara berkelanjutan.",
    story:
      "Program ini menghimpun zakat dari para donatur dan menyalurkannya secara berkelanjutan kepada delapan asnaf melalui jaringan amil mitra. Karena sifatnya berkelanjutan, program ini tidak memiliki target atau tenggat waktu -- dana yang tersedia langsung disalurkan sesuai kebutuhan mustahik yang terverifikasi.",
    coverMediaUrl: "campaigns/covers/program-amil-zakat-mitra.jpg",
    categorySlug: "zakat",
    campaignerName: "GalangDana Program Mitra",
    model: "program",
    goalAmount: null,
    expiresAt: null,
    collectedAmount: 1_820_400_000n,
    disbursedAmount: 1_650_000_000n,
    donationCount: 6210,
  },
  {
    slug: "wakaf-produktif-sumur-bor-desa-kering",
    title: "Wakaf Produktif: Sumur Bor untuk Desa yang Kekeringan",
    shortDescription:
      "Bangun sumur bor wakaf untuk desa yang setiap musim kemarau kesulitan air bersih.",
    story:
      "Setiap musim kemarau, warga desa ini harus berjalan berkilo-kilometer untuk mendapatkan air bersih. Wakaf sumur bor ini akan memberikan akses air bersih jangka panjang bagi ratusan keluarga, dan hasilnya dapat dirasakan turun-temurun.",
    coverMediaUrl: "campaigns/covers/wakaf-sumur-bor.jpg",
    categorySlug: "wakaf",
    campaignerName: "Yayasan Bina Umat Sejahtera",
    model: "goal",
    goalAmount: 120_000_000n,
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    collectedAmount: 54_000_000n,
    disbursedAmount: 0n,
    donationCount: 198,
  },
  {
    slug: "bantu-panti-asuhan-kasih-bunda",
    title: "Bantu Panti Asuhan Kasih Bunda Penuhi Kebutuhan Harian",
    shortDescription:
      "Dukung kebutuhan harian 34 anak di Panti Asuhan Kasih Bunda secara berkelanjutan.",
    story:
      "Panti Asuhan Kasih Bunda menampung 34 anak dari berbagai latar belakang. Program ini menghimpun donasi rutin untuk kebutuhan sehari-hari: makan, pendidikan, dan kesehatan. Karena kebutuhannya berkelanjutan, program ini tidak memiliki target akhir -- dana yang tersedia langsung digunakan untuk operasional panti.",
    coverMediaUrl: "campaigns/covers/panti-asuhan-kasih-bunda.jpg",
    categorySlug: "panti-asuhan",
    campaignerName: "Yayasan Peduli Sesama",
    model: "program",
    goalAmount: null,
    expiresAt: null,
    collectedAmount: 425_600_000n,
    disbursedAmount: 398_000_000n,
    donationCount: 3021,
  },
  {
    slug: "beasiswa-anak-yatim-berprestasi",
    title: "Beasiswa Pendidikan untuk Anak Yatim Berprestasi",
    shortDescription:
      "Bantu anak-anak yatim berprestasi melanjutkan pendidikan mereka tanpa terbebani biaya sekolah.",
    story:
      "Banyak anak yatim berprestasi terpaksa putus sekolah karena keterbatasan biaya. Program beasiswa ini menanggung biaya pendidikan bagi 20 anak terpilih selama satu tahun ajaran penuh, mulai dari SPP hingga perlengkapan sekolah.",
    coverMediaUrl: "campaigns/covers/beasiswa-anak-yatim.jpg",
    categorySlug: "beasiswa-pendidikan",
    campaignerName: "Rina Wijaya",
    model: "goal",
    goalAmount: 150_000_000n,
    expiresAt: new Date(Date.now() + 60 * DAY_MS),
    collectedAmount: 22_100_000n,
    disbursedAmount: 0n,
    donationCount: 89,
  },
  {
    slug: "pengobatan-darurat-nenek-sari",
    title: "Pengobatan Darurat untuk Nenek Sari, Lansia Tanpa Keluarga",
    shortDescription:
      "Nenek Sari (78) membutuhkan perawatan intensif namun tidak memiliki keluarga yang dapat membantu.",
    story:
      "Nenek Sari tinggal sendiri dan didiagnosis membutuhkan perawatan intensif. Tanpa keluarga yang dapat membantu membiayai pengobatannya, warga sekitar berinisiatif menggalang dana untuk memastikan beliau mendapat perawatan yang layak.",
    coverMediaUrl: "campaigns/covers/nenek-sari-pengobatan.jpg",
    categorySlug: "bantuan-medis",
    campaignerName: "Budi Santoso",
    model: "goal",
    goalAmount: 60_000_000n,
    expiresAt: new Date(Date.now() + 5 * DAY_MS),
    collectedAmount: 57_300_000n,
    disbursedAmount: 0n,
    donationCount: 421,
  },
];
```

- [ ] **Step 5: Wire the seed script — modify `packages/db/src/seed/run-seed.ts`**

```ts
import { db } from "../client";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";
import { CATEGORY_SEED_DATA } from "./categories.seed";
import { CAMPAIGNER_SEED_DATA } from "./campaigners.seed";
import { CAMPAIGN_SEED_DATA } from "./campaigns.seed";
import { eq } from "drizzle-orm";

async function runSeed() {
  await db
    .insert(campaignCategories)
    .values(CATEGORY_SEED_DATA)
    .onConflictDoNothing({ target: campaignCategories.id });
  console.log(`Seeded ${CATEGORY_SEED_DATA.length} categories.`);

  // Campaigners have no natural unique business key to conflict-detect on
  // (displayName isn't declared unique at the schema level -- two real
  // campaigners could share a name), so re-running this script is safe
  // only because it looks up existing rows by name first rather than
  // blindly re-inserting. This is a fixture-seeding convenience, not a
  // pattern real campaigner creation should copy.
  const campaignerIdByName = new Map<string, string>();
  for (const seed of CAMPAIGNER_SEED_DATA) {
    const [existing] = await db
      .select()
      .from(campaigners)
      .where(eq(campaigners.displayName, seed.displayName));
    if (existing) {
      campaignerIdByName.set(seed.displayName, existing.id);
      continue;
    }
    const [created] = await db.insert(campaigners).values(seed).returning();
    if (!created) throw new Error(`failed to insert campaigner ${seed.displayName}`);
    campaignerIdByName.set(seed.displayName, created.id);
  }
  console.log(`Seeded ${CAMPAIGNER_SEED_DATA.length} campaigners.`);

  const categoryIdBySlug = new Map(
    (await db.select().from(campaignCategories)).map((c) => [c.slug, c.id]),
  );

  let campaignsSeeded = 0;
  for (const seed of CAMPAIGN_SEED_DATA) {
    const categoryId = categoryIdBySlug.get(seed.categorySlug);
    const campaignerId = campaignerIdByName.get(seed.campaignerName);
    if (!categoryId) throw new Error(`unknown category slug in seed data: ${seed.categorySlug}`);
    if (!campaignerId) throw new Error(`unknown campaigner name in seed data: ${seed.campaignerName}`);

    await db
      .insert(campaigns)
      .values({
        slug: seed.slug,
        title: seed.title,
        shortDescription: seed.shortDescription,
        story: seed.story,
        coverMediaUrl: seed.coverMediaUrl,
        categoryId,
        campaignerId,
        model: seed.model,
        goalAmount: seed.goalAmount,
        expiresAt: seed.expiresAt,
        collectedAmount: seed.collectedAmount,
        disbursedAmount: seed.disbursedAmount,
        donationCount: seed.donationCount,
        status: "active",
        publishedAt: new Date(),
      })
      .onConflictDoNothing({ target: campaigns.slug });
    campaignsSeeded++;
  }
  console.log(`Seeded ${campaignsSeeded} campaigns.`);
}

if (import.meta.main) {
  await runSeed();
  process.exit(0);
}

export { runSeed };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/seed-data.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 7: Run the seed script against the local dev database**

Run: `cd packages/db && bun run db:seed`
Expected: prints `Seeded 17 categories.`, `Seeded 5 campaigners.`, `Seeded 8 campaigns.` Run it a second time immediately after and confirm it's idempotent (no duplicate-key errors, counts stay the same on the campaigns/campaigners side since `onConflictDoNothing`/the name-lookup both no-op on a second run).

- [ ] **Step 8: Spot-check the CHECK constraint from Phase 0a still holds against real data**

Run a quick query (via `bun run` a throwaway script, or `psql`) confirming every `model = 'program'` row has `goal_amount IS NULL AND expires_at IS NULL`, and every `model = 'goal'` row has `goal_amount IS NOT NULL` — this is enforced by the database's own CHECK constraint (Phase 0a), so a seed row that violated it would have failed to insert at Step 7, not silently succeeded; this step is a read-only confirmation, not a new behavior.

- [ ] **Step 9: Run the full `packages/db` suite and typecheck**

Run: `cd packages/db && bun test && bun run typecheck`
Expected: all pass, 0 errors.

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): add campaigner and campaign fixture data"
```

---

## Task 3: Media pipeline — `packages/media` (imgproxy URL signing) + imgproxy/MinIO infra + seeded cover images

**Files:**
- Create: `packages/media/package.json`
- Create: `packages/media/tsconfig.json`
- Create: `packages/media/src/imgproxy.ts`
- Test: `packages/media/src/imgproxy.test.ts`
- Create: `packages/media/src/index.ts`
- Modify: `/home/ubuntu/galangdana/docker-compose.yml` (add `imgproxy` service)
- Modify: `/home/ubuntu/galangdana/.env.example` (add `IMGPROXY_KEY`, `IMGPROXY_SALT`, `IMGPROXY_BASE_URL`, `MEDIA_SOURCE_BASE_URL`, `MEDIA_S3_*` vars)
- Create: `packages/db/src/seed/upload-cover-images.ts`

**Interfaces:**
- Consumes: `coverMediaUrl` object keys from Task 2's seed data (as literal strings this task uploads real files to match — no code dependency, just data-shape agreement).
- Produces: `buildImgproxyUrl(objectKey: string, options?: ImgproxyOptions): string`, importable as `import { buildImgproxyUrl } from "@galangdana/media";`. Signature verified against a real running imgproxy instance during this plan's own research (HMAC-SHA256 over `salt + path`, base64url-encoded, `IMGPROXY_ALLOW_LOOPBACK_SOURCE_ADDRESSES=true` required for local dev since the source is MinIO on `localhost`).

- [ ] **Step 1: Scaffold `packages/media/package.json`**

```json
{
  "name": "@galangdana/media",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: `packages/media/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json"
}
```

- [ ] **Step 3: Write the failing test — `packages/media/src/imgproxy.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { buildImgproxyUrl } from "./imgproxy";

// Fixed, known key/salt so this test's expected signature is a literal,
// reproducible value -- not "does it look plausible," but "is this the
// exact byte-for-byte signature imgproxy itself would compute," verified
// by generating this exact URL against a real running imgproxy container
// with this exact key/salt pair during this plan's research and
// confirming a 200 with a correctly-resized image back.
const TEST_KEY = "4ac5d314cc578f0216d080c03b2bc517a7e4226af8a4ed6a5617cf94e44c554c";
const TEST_SALT = "00325181fcb6c7a7ef94ba22eab86f3115ddfaf7178dcba96d19a327c0ab65f1";

describe("buildImgproxyUrl", () => {
  test("produces the exact signed URL imgproxy itself validated, for a known key/salt/object key", async () => {
    const url = await buildImgproxyUrl("test-image.jpg", {
      key: TEST_KEY,
      salt: TEST_SALT,
      baseUrl: "http://localhost:8090",
      sourceBaseUrl: "http://localhost:9000/campaign-media",
      resize: { width: 300, height: 200 },
    });
    expect(url).toBe(
      "http://localhost:8090/k9mZt7zOjEifZfzF7xAev5soKVBtEgSr9zqUYLzi79Y/rs:fill:300:200:0/aHR0cDovL2xvY2FsaG9zdDo5MDAwL2NhbXBhaWduLW1lZGlhL3Rlc3QtaW1hZ2UuanBn.jpg",
    );
  });

  test("different resize dimensions produce a different signature", async () => {
    const url = await buildImgproxyUrl("test-image.jpg", {
      key: TEST_KEY,
      salt: TEST_SALT,
      baseUrl: "http://localhost:8090",
      sourceBaseUrl: "http://localhost:9000/campaign-media",
      resize: { width: 600, height: 400 },
    });
    expect(url).toContain("/rs:fill:600:400:0/");
    expect(url).not.toContain("k9mZt7zOjEifZfzF7xAev5soKVBtEgSr9zqUYLzi79Y");
  });

  test("preserves the source object key's extension in the final path segment", async () => {
    const url = await buildImgproxyUrl("nested/path/photo.png", {
      key: TEST_KEY,
      salt: TEST_SALT,
      baseUrl: "http://localhost:8090",
      sourceBaseUrl: "http://localhost:9000/campaign-media",
      resize: { width: 100, height: 100 },
    });
    expect(url.endsWith(".png")).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd packages/media && bun test src/imgproxy.test.ts`
Expected: FAIL — `Cannot find module './imgproxy'`.

- [ ] **Step 5: Implement `packages/media/src/imgproxy.ts`**

```ts
export interface ImgproxyResize {
  width: number;
  height: number;
}

export interface ImgproxyOptions {
  /** Hex-encoded signing key. In apps/api this comes from process.env.IMGPROXY_KEY. */
  key: string;
  /** Hex-encoded signing salt. In apps/api this comes from process.env.IMGPROXY_SALT. */
  salt: string;
  /** The imgproxy server's own base URL, e.g. http://localhost:8090 in dev. */
  baseUrl: string;
  /** Base URL the source object key is resolved against, e.g. the media bucket's public/internal endpoint. */
  sourceBaseUrl: string;
  resize: ImgproxyResize;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * imgproxy's URL-signing scheme, verified against a real running imgproxy
 * instance: HMAC-SHA256 over (salt bytes ++ UTF-8 path bytes), base64url
 * encoded (no padding -- Node/Bun's "base64url" Buffer encoding already
 * omits padding, matching what imgproxy expects). Key and salt are
 * hex-encoded strings, decoded to raw bytes before signing -- passing the
 * hex STRING itself as the HMAC key (rather than its decoded bytes) is a
 * common mistake that produces a signature imgproxy rejects; this was
 * caught and corrected during this plan's own verification against a
 * running imgproxy container.
 */
async function signImgproxyPath(path: string, key: string, salt: string): Promise<string> {
  const keyBytes = hexToBytes(key);
  const saltBytes = hexToBytes(salt);
  const message = new Uint8Array([...saltBytes, ...new TextEncoder().encode(path)]);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return Buffer.from(signature).toString("base64url");
}

/**
 * Builds a fully-signed imgproxy URL for a media object. `objectKey` is a
 * relative path within the media bucket (e.g. "campaigns/covers/x.jpg"),
 * never a full URL -- see this plan's Global Constraints for why the
 * database only ever stores the key, not a full URL.
 */
export async function buildImgproxyUrl(objectKey: string, options: ImgproxyOptions): Promise<string> {
  const sourceUrl = `${options.sourceBaseUrl}/${objectKey}`;
  const encodedUrl = Buffer.from(sourceUrl).toString("base64url");
  const extension = objectKey.includes(".") ? objectKey.slice(objectKey.lastIndexOf(".") + 1) : "jpg";
  const processingOptions = `rs:fill:${options.resize.width}:${options.resize.height}:0`;
  const path = `/${processingOptions}/${encodedUrl}.${extension}`;
  const signature = await signImgproxyPath(path, options.key, options.salt);
  return `${options.baseUrl}/${signature}${path}`;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/media && bun test src/imgproxy.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 7: `packages/media/src/index.ts`**

```ts
export { buildImgproxyUrl } from "./imgproxy";
export type { ImgproxyOptions, ImgproxyResize } from "./imgproxy";
```

- [ ] **Step 8: Add the `imgproxy` service to `docker-compose.yml`**

Insert as a new service (alphabetical position among the existing services, after `mailpit`):

```yaml
  imgproxy:
    image: darthsim/imgproxy:latest
    environment:
      IMGPROXY_KEY: ${IMGPROXY_KEY:-4ac5d314cc578f0216d080c03b2bc517a7e4226af8a4ed6a5617cf94e44c554c}
      IMGPROXY_SALT: ${IMGPROXY_SALT:-00325181fcb6c7a7ef94ba22eab86f3115ddfaf7178dcba96d19a327c0ab65f1}
      # Dev-only: MinIO is reached at localhost/127.0.0.1 from the host
      # machine (see the port mapping on the minio service below), and
      # imgproxy refuses loopback source addresses by default as an SSRF
      # protection -- verified directly (a signed, correctly-formed
      # request 404s with "Loopback source address is not allowed"
      # without this). Never set this in a real deployment, where the
      # media source is a real, non-loopback host.
      IMGPROXY_ALLOW_LOOPBACK_SOURCE_ADDRESSES: "true"
    ports: ["8090:8080"]
    healthcheck:
      test: ["CMD", "imgproxy", "health"]
      interval: 5s
      timeout: 5s
      retries: 10
```

Note the container's internal port is imgproxy's default `8080` (not the `8090` this plan's research used on the host directly, which was chosen only to dodge a port collision on the researcher's shared machine) — mapped to host port `8090` here so `IMGPROXY_BASE_URL=http://localhost:8090` in `.env.example` is correct for local dev either way.

- [ ] **Step 9: Add env vars to `.env.example`**

Append:

```
# Media pipeline (imgproxy + MinIO) -- Phase 1
IMGPROXY_KEY=4ac5d314cc578f0216d080c03b2bc517a7e4226af8a4ed6a5617cf94e44c554c
IMGPROXY_SALT=00325181fcb6c7a7ef94ba22eab86f3115ddfaf7178dcba96d19a327c0ab65f1
IMGPROXY_BASE_URL=http://localhost:8090
MEDIA_SOURCE_BASE_URL=http://localhost:9000/campaign-media
MEDIA_S3_ENDPOINT=http://localhost:9000
MEDIA_S3_ACCESS_KEY_ID=galangdana
MEDIA_S3_SECRET_ACCESS_KEY=galangdana-dev-secret
MEDIA_S3_BUCKET=campaign-media
```

The dev key/salt above are placeholder values checked into source control deliberately — this is local-dev-only infrastructure with no real user data behind it (matching how `docker-compose.yml`'s existing `MINIO_ROOT_PASSWORD: galangdana-dev-secret` is already a checked-in dev secret). A real deployment generates its own key/salt and never commits them.

- [ ] **Step 10: Implement `packages/db/src/seed/upload-cover-images.ts`**

Uses Bun's native S3 client (verified directly against the real running MinIO container during this plan's research — no AWS SDK dependency needed), and downloads real placeholder photographs from a public placeholder-image service (not any donation platform's actual campaign photography) to populate visually distinct cover images for each seeded campaign.

```ts
import { CAMPAIGN_SEED_DATA } from "./campaigns.seed";

const s3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "galangdana",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "galangdana-dev-secret",
  bucket: process.env.MEDIA_S3_BUCKET ?? "campaign-media",
  region: "us-east-1",
});

async function ensureBucketExists(): Promise<void> {
  // Bun's S3Client has no createBucket method -- MinIO's bucket-creation
  // API is a plain HTTP PUT to the bucket root, which this does directly
  // rather than pulling in a bucket-management SDK for one call.
  const endpoint = process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000";
  const bucket = process.env.MEDIA_S3_BUCKET ?? "campaign-media";
  const response = await fetch(`${endpoint}/${bucket}`, { method: "HEAD" });
  if (response.ok) return;

  // A real signed PUT would need SigV4 -- sidestepped here by using
  // MinIO's default dev credentials only for local seeding, via a plain
  // unauthenticated attempt first (MinIO in this docker-compose config
  // has no bucket-creation-specific auth beyond what mc/S3Client already
  // handle for object operations). If this fails, the developer running
  // seed needs to create the bucket once via `docker compose exec minio
  // mc mb local/campaign-media` or the MinIO console at :9001 -- fail
  // loudly with that instruction rather than silently skip image upload.
  throw new Error(
    `Bucket "${bucket}" does not exist at ${endpoint}. Create it once via the MinIO console ` +
      `(http://localhost:9001, login galangdana/galangdana-dev-secret) or ` +
      `\`docker compose exec minio mc mb local/campaign-media\`, then re-run this script.`,
  );
}

async function uploadCoverImages(): Promise<void> {
  await ensureBucketExists();

  let uploaded = 0;
  for (const campaign of CAMPAIGN_SEED_DATA) {
    const file = s3.file(campaign.coverMediaUrl);
    if (await file.exists()) {
      continue; // idempotent: skip images already uploaded by a prior run
    }
    // picsum.photos serves real, freely-licensed placeholder photographs
    // designed for exactly this purpose -- a stable per-seed-slug seed
    // value keeps the same campaign always getting the same placeholder
    // image across repeated `db:seed` runs.
    const response = await fetch(`https://picsum.photos/seed/${campaign.slug}/800/600`);
    if (!response.ok) {
      throw new Error(`failed to fetch placeholder image for ${campaign.slug}: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    await s3.write(campaign.coverMediaUrl, bytes, { type: "image/jpeg" });
    uploaded++;
  }
  console.log(`Uploaded ${uploaded} cover images (${CAMPAIGN_SEED_DATA.length - uploaded} already present).`);
}

if (import.meta.main) {
  await uploadCoverImages();
  process.exit(0);
}

export { uploadCoverImages };
```

- [ ] **Step 11: Start the new infra and run the upload script**

Run: `docker compose up -d imgproxy` (from the repo root), then confirm it becomes healthy: `docker compose ps imgproxy`.

Create the bucket once (matching the error message's own instruction, since `ensureBucketExists` deliberately does not auto-create it):
`docker compose exec minio mc alias set local http://localhost:9000 galangdana galangdana-dev-secret && docker compose exec minio mc mb local/campaign-media && docker compose exec minio mc anonymous set download local/campaign-media`

Then: `cd packages/db && bun run src/seed/upload-cover-images.ts`
Expected: `Uploaded 8 cover images (0 already present).` Run it again immediately and confirm: `Uploaded 0 cover images (8 already present).`

- [ ] **Step 12: Verify one real image resolves end to end through imgproxy**

Run a throwaway script or `bun -e` snippet calling `buildImgproxyUrl("campaigns/covers/banjir-kalimantan-selatan.jpg", { key: process.env.IMGPROXY_KEY!, salt: process.env.IMGPROXY_SALT!, baseUrl: "http://localhost:8090", sourceBaseUrl: "http://localhost:9000/campaign-media", resize: { width: 400, height: 300 } })`, then `curl` the resulting URL and confirm a `200` with `content-type: image/jpeg` and a body that's a valid 400x300 JPEG (`file` on the downloaded bytes, matching the verification already done during this plan's research).

- [ ] **Step 13: Run the full `packages/media` suite and typecheck**

Run: `cd packages/media && bun test && bun run typecheck`
Expected: all pass, 0 errors.

- [ ] **Step 14: Add `packages/media` to the root test/typecheck wiring**

Root `package.json`'s `"typecheck": "bun run --filter='*' typecheck"` already covers every workspace package automatically — no change needed there. `packages/media` uses `bun:test` like `packages/money`/`contracts`/`db`, so add it to the root `test` script (modify, don't just append a new script, matching how Phase 0c had to explicitly scope `packages/ui` OUT of this same line for the opposite reason):

```json
"test": "bun test packages/money packages/contracts packages/db packages/media apps/api",
```

- [ ] **Step 15: Add a CI step**

`.github/workflows/ci.yml` already runs the root `test` script as one step (`Unit tests (packages + api)`), so `packages/media`'s tests run automatically once Step 14 lands — no separate CI step needed. Confirm this is true by re-reading that step's `run:` line.

- [ ] **Step 16: Run the full local verification**

Run: `bun install && bun run lint && bun run typecheck && bun run test`
Expected: all clean.

- [ ] **Step 17: Commit**

```bash
git add packages/media docker-compose.yml .env.example packages/db package.json
git commit -m "feat(media): add imgproxy URL signing, imgproxy service, and seeded cover images"
```

---

## Task 4: Search pipeline — `packages/search` (Meilisearch client + indexing)

**Files:**
- Create: `packages/search/package.json`
- Create: `packages/search/tsconfig.json`
- Create: `packages/search/src/client.ts`
- Create: `packages/search/src/campaigns-index.ts`
- Test: `packages/search/src/campaigns-index.test.ts`
- Create: `packages/search/src/reindex.ts`
- Create: `packages/search/src/index.ts`

**Interfaces:**
- Consumes: `campaigns`, `campaignCategories`, `campaigners`, `displayAmount` from `@galangdana/db` (Task 1/2 and Phase 0a).
- Produces: `getMeilisearchClient(): Meilisearch`, `syncCampaignsIndex(rows: CampaignSearchDocument[]): Promise<void>`, `searchCampaigns(query: string, opts?: { categoryId?: number; limit?: number }): Promise<CampaignSearchDocument[]>`, all importable from `@galangdana/search`.

- [ ] **Step 1: Scaffold `packages/search/package.json`**

```json
{
  "name": "@galangdana/search",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "reindex": "bun run src/reindex.ts"
  },
  "dependencies": {
    "meilisearch": "0.60.0"
  }
}
```

- [ ] **Step 2: `packages/search/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json"
}
```

- [ ] **Step 3: Implement `packages/search/src/client.ts`**

```ts
import { Meilisearch } from "meilisearch";

// Note the class name: `Meilisearch` (lowercase "s"), not `MeiliSearch` --
// verified against the actually-installed 0.60.0 client; older
// documentation/examples for this library use the capitalized form from
// a prior major version, which does not exist in this package's exports.
export function getMeilisearchClient(): Meilisearch {
  return new Meilisearch({
    host: process.env.MEILISEARCH_URL ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_API_KEY ?? "galangdana-dev-master-key",
  });
}
```

- [ ] **Step 4: Write the failing test — `packages/search/src/campaigns-index.test.ts`**

This test hits the real, already-running Meilisearch instance from `docker-compose.yml` (no mocking) -- matching this codebase's established "tests use real infrastructure" pattern from every earlier phase.

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getMeilisearchClient } from "./client";
import { CAMPAIGNS_INDEX_NAME, searchCampaigns, syncCampaignsIndex } from "./campaigns-index";

const TEST_DOCS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "test-banjir-jakarta",
    title: "Bantu Korban Banjir Jakarta",
    shortDescription: "Test fixture",
    categoryId: 22,
    categorySlug: "bencana-alam",
    model: "goal" as const,
    createdAtMs: 1000,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    slug: "test-anak-sakit",
    title: "Bantu Pengobatan Anak Sakit",
    shortDescription: "Test fixture",
    categoryId: 8,
    categorySlug: "balita-anak-sakit",
    model: "goal" as const,
    createdAtMs: 2000,
  },
];

describe("campaigns search index", () => {
  beforeEach(async () => {
    await syncCampaignsIndex(TEST_DOCS);
  });

  afterEach(async () => {
    const client = getMeilisearchClient();
    const task = await client.index(CAMPAIGNS_INDEX_NAME).deleteAllDocuments();
    await client.tasks.waitForTask(task.taskUid);
  });

  test("indexes documents with an explicit primary key -- required because 'id' and 'categoryId' both end in 'id', which breaks Meilisearch's auto-inference", async () => {
    // This test's own existence is the regression guard: verified during
    // this plan's research that omitting an explicit primaryKey on a
    // document shaped like this makes the indexing TASK silently fail
    // (status: "failed", not a thrown error) with
    // "index_primary_key_multiple_candidates_found" -- a caller that
    // doesn't check task status would see an empty search index with no
    // visible error at all.
    const results = await searchCampaigns("banjir jakarta");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.slug).toBe("test-banjir-jakarta");
  });

  test("search is typo-tolerant", async () => {
    const results = await searchCampaigns("banjir jakrta"); // deliberate typo
    expect(results.some((r) => r.slug === "test-banjir-jakarta")).toBe(true);
  });

  test("filters by categoryId", async () => {
    const results = await searchCampaigns("", { categoryId: 8 });
    expect(results.length).toBe(1);
    expect(results[0]?.slug).toBe("test-anak-sakit");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd packages/search && bun test src/campaigns-index.test.ts`
Expected: FAIL — `Cannot find module './campaigns-index'`.

- [ ] **Step 6: Implement `packages/search/src/campaigns-index.ts`**

```ts
import { getMeilisearchClient } from "./client";

export const CAMPAIGNS_INDEX_NAME = "campaigns";

export interface CampaignSearchDocument {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  categoryId: number;
  categorySlug: string;
  model: "goal" | "program";
  createdAtMs: number;
}

/**
 * Replaces the entire campaigns index with the given documents. Full
 * replace (not incremental upsert) is the right shape for this phase:
 * there is no campaign-creation flow yet, so the only caller is a
 * from-scratch reindex script (see reindex.ts). A future phase that adds
 * live campaign creation should add an incremental
 * index.addDocuments([one document]) call at the write site instead of
 * calling this on every write.
 */
export async function syncCampaignsIndex(documents: CampaignSearchDocument[]): Promise<void> {
  const client = getMeilisearchClient();
  const index = client.index(CAMPAIGNS_INDEX_NAME);

  const filterableTask = await index.updateFilterableAttributes(["categoryId", "categorySlug", "model"]);
  await client.tasks.waitForTask(filterableTask.taskUid);
  const sortableTask = await index.updateSortableAttributes(["createdAtMs"]);
  await client.tasks.waitForTask(sortableTask.taskUid);

  // primaryKey MUST be specified explicitly -- verified during this
  // plan's research that Meilisearch's auto-inference gets confused when
  // a document has multiple fields ending in "id" ("id" and
  // "categoryId" here) and the indexing task fails silently (status:
  // "failed" on the task, no thrown exception) rather than picking one.
  const task = await index.addDocuments(documents, { primaryKey: "id" });
  const result = await client.tasks.waitForTask(task.taskUid);
  if (result.status !== "succeeded") {
    throw new Error(`campaigns index sync failed: ${JSON.stringify(result.error)}`);
  }
}

export interface SearchCampaignsOptions {
  categoryId?: number;
  limit?: number;
}

export async function searchCampaigns(
  query: string,
  opts: SearchCampaignsOptions = {},
): Promise<CampaignSearchDocument[]> {
  const client = getMeilisearchClient();
  const index = client.index<CampaignSearchDocument>(CAMPAIGNS_INDEX_NAME);
  const filter = opts.categoryId !== undefined ? `categoryId = ${opts.categoryId}` : undefined;
  const results = await index.search(query, { filter, limit: opts.limit ?? 20 });
  return results.hits;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd packages/search && bun test src/campaigns-index.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 8: Implement `packages/search/src/reindex.ts`**

```ts
import { db, campaignCategories, campaigns } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { syncCampaignsIndex } from "./campaigns-index";

async function reindex(): Promise<void> {
  const rows = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      title: campaigns.title,
      shortDescription: campaigns.shortDescription,
      categoryId: campaigns.categoryId,
      categorySlug: campaignCategories.slug,
      model: campaigns.model,
      createdAt: campaigns.createdAt,
      status: campaigns.status,
    })
    .from(campaigns)
    .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id));

  const documents = rows
    .filter((r) => r.status === "active")
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      shortDescription: r.shortDescription,
      categoryId: r.categoryId,
      categorySlug: r.categorySlug,
      model: r.model,
      createdAtMs: r.createdAt.getTime(),
    }));

  await syncCampaignsIndex(documents);
  console.log(`Reindexed ${documents.length} active campaigns into Meilisearch.`);
}

if (import.meta.main) {
  await reindex();
  process.exit(0);
}

export { reindex };
```

- [ ] **Step 9: `packages/search/src/index.ts`**

```ts
export { getMeilisearchClient } from "./client";
export {
  CAMPAIGNS_INDEX_NAME,
  searchCampaigns,
  syncCampaignsIndex,
} from "./campaigns-index";
export type { CampaignSearchDocument, SearchCampaignsOptions } from "./campaigns-index";
```

- [ ] **Step 10: Run the reindex script against the real seeded data**

Run: `cd packages/search && bun run reindex`
Expected: `Reindexed 8 active campaigns into Meilisearch.` (assumes Task 2's seed already ran). Spot-check with a manual search: `cd packages/search && bun -e 'import { searchCampaigns } from "./src/index"; console.log(await searchCampaigns("banjir"));'` and confirm the Kalimantan Selatan flood campaign comes back.

- [ ] **Step 11: Update root `package.json` and CI**

Add `packages/search` to the root `test` script (Step 14 of Task 3 already changed this line — extend it further):

```json
"test": "bun test packages/money packages/contracts packages/db packages/media packages/search apps/api",
```

- [ ] **Step 12: Run the full local verification**

Run: `bun install && bun run lint && bun run typecheck && bun run test`
Expected: all clean.

- [ ] **Step 13: Commit**

```bash
git add packages/search package.json
git commit -m "feat(search): add Meilisearch client, campaign indexing, and reindex script"
```

---

## Task 5: Campaign contracts

**Files:**
- Create: `packages/contracts/src/campaigns.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: nothing new (pure TypeBox schema definitions).
- Produces: `CampaignSummarySchema`, `CampaignDetailSchema`, `CampaignListResponseSchema`, `CampaignListQuerySchema`, `SearchResponseSchema`, `SearchQuerySchema`, `MoneyJSONSchema`, all exported from `@galangdana/contracts`, consumed by Tasks 6-8 (API routes) and indirectly by Tasks 10-13 (SSR pages, via the Eden Treaty client's inferred types — no direct import needed there).

- [ ] **Step 1: Implement `packages/contracts/src/campaigns.ts`**

```ts
import { Type, type Static } from "@sinclair/typebox";

// Mirrors @galangdana/money's MoneyJSON shape exactly -- contracts can't
// import a runtime value from another package's *type* declaration
// through TypeBox, so this is a parallel schema definition that must stay
// in sync with packages/money/src/money.ts's MoneyJSON interface by hand.
export const MoneyJSONSchema = Type.Object({
  amount: Type.String(),
  currency: Type.Union([Type.Literal("IDR"), Type.Literal("USD")]),
});
export type MoneyJSONResponse = Static<typeof MoneyJSONSchema>;

export const CampaignCategorySchema = Type.Object({
  id: Type.Number(),
  slug: Type.String(),
  title: Type.String(),
});

export const CampaignerSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: Type.Union([Type.Literal("individual"), Type.Literal("yayasan"), Type.Literal("platform")]),
  displayName: Type.String(),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  verified: Type.Boolean(),
});

// The shared shape between a list-item card and a detail page -- every
// field a <CampaignCard> needs to render, plus the model/goal/expiry
// fields needed to pick goal-vs-program display logic without a second
// round trip.
export const CampaignSummarySchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  title: Type.String(),
  shortDescription: Type.String(),
  coverImageUrl: Type.String(),
  category: CampaignCategorySchema,
  campaigner: CampaignerSchema,
  model: Type.Union([Type.Literal("goal"), Type.Literal("program")]),
  goalAmount: Type.Union([MoneyJSONSchema, Type.Null()]),
  collectedAmount: MoneyJSONSchema,
  availableAmount: MoneyJSONSchema,
  donationCount: Type.Number(),
  expiresAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  publishedAt: Type.String({ format: "date-time" }),
});
export type CampaignSummaryResponse = Static<typeof CampaignSummarySchema>;

export const CampaignDetailSchema = Type.Composite([
  CampaignSummarySchema,
  Type.Object({
    story: Type.String(),
  }),
]);
export type CampaignDetailResponse = Static<typeof CampaignDetailSchema>;

export const CampaignListQuerySchema = Type.Object({
  category: Type.Optional(Type.String()),
  campaignerType: Type.Optional(
    Type.Union([Type.Literal("individual"), Type.Literal("yayasan"), Type.Literal("platform")]),
  ),
  sort: Type.Optional(Type.Union([Type.Literal("urgent"), Type.Literal("newest")])),
  page: Type.Optional(Type.Number({ minimum: 1 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});

export const CampaignListResponseSchema = Type.Object({
  campaigns: Type.Array(CampaignSummarySchema),
  page: Type.Number(),
  totalPages: Type.Number(),
  totalCount: Type.Number(),
});
export type CampaignListResponse = Static<typeof CampaignListResponseSchema>;

export const CampaignErrorSchema = Type.Object({
  error: Type.String(),
});

export const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 1 }),
  category: Type.Optional(Type.String()),
});

export const SearchResponseSchema = Type.Object({
  results: Type.Array(CampaignSummarySchema),
  query: Type.String(),
});
export type SearchResponse = Static<typeof SearchResponseSchema>;
```

Note: `format: "uuid"` and `format: "date-time"` are already registered globally by `packages/contracts/src/auth.ts` and `packages/contracts/src/health.ts` respectively (both modules run their `FormatRegistry.Set(...)` calls at import time) — since `packages/contracts/src/index.ts` imports every contract module into one barrel, both are guaranteed registered before this file's schemas are ever validated. Do not re-register either format here; a second `FormatRegistry.Set` call for the same name is harmless but redundant, and its absence here is deliberate, not an oversight.

- [ ] **Step 2: Update the barrel — `packages/contracts/src/index.ts`**

Add, alongside the existing exports:

```ts
export {
  CampaignCategorySchema,
  CampaignDetailSchema,
  CampaignerSchema,
  CampaignErrorSchema,
  CampaignListQuerySchema,
  CampaignListResponseSchema,
  CampaignSummarySchema,
  MoneyJSONSchema,
  SearchQuerySchema,
  SearchResponseSchema,
} from "./campaigns";
export type {
  CampaignDetailResponse,
  CampaignListResponse,
  CampaignSummaryResponse,
  MoneyJSONResponse,
  SearchResponse,
} from "./campaigns";
```

- [ ] **Step 3: Verify the format registrations actually cover this file's usage**

Run: `cd packages/contracts && bun run typecheck` (typecheck only — this file has no runtime test of its own, since it's pure schema declarations exercised by the API routes in Tasks 6-8, which is where a payload against `format: "uuid"`/`format: "date-time"` first actually runs through `Value.Check`). Confirm 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add campaign list/detail/search schemas"
```

---

## Task 6: `GET /campaigns` — list with category/type filter and urgent/newest sort

**Files:**
- Create: `apps/api/src/lib/campaign-response.ts`
- Create: `apps/api/src/routes/campaigns.ts`
- Test: `apps/api/src/routes/campaigns.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/package.json` (add `@galangdana/media`, `@galangdana/contracts` if not already present — confirm `@galangdana/contracts` is already a dependency from Phase 0b before adding it again)

**Interfaces:**
- Consumes: `campaigns`, `campaignCategories`, `campaigners`, `displayAmount` from `@galangdana/db`; `buildImgproxyUrl` from `@galangdana/media`; `CampaignSummarySchema`, `CampaignListQuerySchema`, `CampaignListResponseSchema` from `@galangdana/contracts`.
- Produces: `toCampaignSummary(row): CampaignSummaryResponse` (a shared mapper Task 7 also uses), `campaignsRoute` mounted at `GET /campaigns`.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/campaigns.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { app } from "../index";

describe("GET /campaigns", () => {
  test("returns a paginated list of active campaigns with money fields as MoneyJSON", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      campaigns: Array<{ collectedAmount: { amount: string; currency: string }; model: string }>;
      page: number;
      totalPages: number;
      totalCount: number;
    };
    expect(body.campaigns.length).toBeGreaterThan(0);
    expect(body.totalCount).toBeGreaterThanOrEqual(8); // this plan's own seed data
    expect(typeof body.campaigns[0]?.collectedAmount.amount).toBe("string");
  });

  test("filters by category slug", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?category=zakat"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { campaigns: Array<{ category: { slug: string } }> };
    expect(body.campaigns.length).toBeGreaterThan(0);
    for (const c of body.campaigns) {
      expect(c.category.slug).toBe("zakat");
    }
  });

  test("sort=newest orders by publishedAt descending", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?sort=newest&limit=50"));
    const body = (await resp.json()) as { campaigns: Array<{ publishedAt: string }> };
    const dates = body.campaigns.map((c) => new Date(c.publishedAt).getTime());
    const sorted = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sorted);
  });

  test("sort=urgent orders goal-model campaigns by soonest deadline first, program campaigns last", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?sort=urgent&limit=50"));
    const body = (await resp.json()) as {
      campaigns: Array<{ model: string; expiresAt: string | null }>;
    };
    const goalCampaigns = body.campaigns.filter((c) => c.model === "goal");
    const deadlines = goalCampaigns.map((c) => new Date(c.expiresAt as string).getTime());
    const sorted = [...deadlines].sort((a, b) => a - b);
    expect(deadlines).toEqual(sorted);

    const lastGoalIndex = body.campaigns.map((c) => c.model).lastIndexOf("goal");
    const firstProgramIndex = body.campaigns.map((c) => c.model).indexOf("program");
    if (firstProgramIndex !== -1) {
      expect(lastGoalIndex).toBeLessThan(firstProgramIndex);
    }
  });

  test("cover image URLs are real, fully-formed imgproxy URLs, not raw object keys", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?limit=1"));
    const body = (await resp.json()) as { campaigns: Array<{ coverImageUrl: string }> };
    expect(body.campaigns[0]?.coverImageUrl).toMatch(/^http:\/\/localhost:8090\//);
    expect(body.campaigns[0]?.coverImageUrl).not.toContain("campaigns/covers/");
  });

  test("pagination: limit and page narrow the result set", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?limit=2&page=1"));
    const body = (await resp.json()) as { campaigns: unknown[]; page: number };
    expect(body.campaigns.length).toBe(2);
    expect(body.page).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: FAIL — the route doesn't exist yet (connection/404 or import error, depending on whether `campaignsRoute` is referenced anywhere yet).

- [ ] **Step 3: Add `@galangdana/media` as an `apps/api` dependency**

Modify `apps/api/package.json`, adding to `dependencies` (confirm `@galangdana/contracts` and `@galangdana/db` are already listed from earlier phases — do not duplicate them):

```json
"@galangdana/media": "workspace:*",
```

Run `bun install` from the repo root after this edit.

- [ ] **Step 4: Implement the shared response mapper — `apps/api/src/lib/campaign-response.ts`**

```ts
import type { Campaign, CampaignCategory, Campaigner } from "@galangdana/db";
import { displayAmount } from "@galangdana/db";
import { buildImgproxyUrl } from "@galangdana/media";
import { moneyToJSON } from "@galangdana/money";
import type { CampaignSummaryResponse } from "@galangdana/contracts";

export interface CampaignRow {
  campaign: Campaign;
  category: CampaignCategory;
  campaigner: Campaigner;
}

function imgproxyConfig() {
  return {
    key: process.env.IMGPROXY_KEY ?? "",
    salt: process.env.IMGPROXY_SALT ?? "",
    baseUrl: process.env.IMGPROXY_BASE_URL ?? "http://localhost:8090",
    sourceBaseUrl: process.env.MEDIA_SOURCE_BASE_URL ?? "http://localhost:9000/campaign-media",
  };
}

/**
 * Shared by both /campaigns (list) and /campaigns/:slug (detail) --
 * building the imgproxy URL here, once, server-side, is the enforcement
 * point for this plan's Global Constraint that the signing key never
 * reaches apps/web.
 */
export async function toCampaignSummary(row: CampaignRow): Promise<CampaignSummaryResponse> {
  const { campaign, category, campaigner } = row;
  const coverImageUrl = campaign.coverMediaUrl
    ? await buildImgproxyUrl(campaign.coverMediaUrl, {
        ...imgproxyConfig(),
        resize: { width: 800, height: 600 },
      })
    : "";

  return {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    shortDescription: campaign.shortDescription,
    coverImageUrl,
    category: { id: category.id, slug: category.slug, title: category.title },
    campaigner: {
      id: campaigner.id,
      type: campaigner.type,
      displayName: campaigner.displayName,
      avatarUrl: campaigner.avatarUrl,
      verified: campaigner.verifiedAt !== null,
    },
    model: campaign.model,
    goalAmount: campaign.goalAmount
      ? moneyToJSON({ amount: campaign.goalAmount, currency: campaign.currency })
      : null,
    collectedAmount: moneyToJSON({ amount: campaign.collectedAmount, currency: campaign.currency }),
    availableAmount: moneyToJSON(displayAmount(campaign)),
    donationCount: campaign.donationCount,
    expiresAt: campaign.expiresAt?.toISOString() ?? null,
    publishedAt: (campaign.publishedAt ?? campaign.createdAt).toISOString(),
  };
}
```

- [ ] **Step 5: Implement `apps/api/src/routes/campaigns.ts`**

```ts
import { CampaignErrorSchema, CampaignListQuerySchema, CampaignListResponseSchema } from "@galangdana/contracts";
import { campaignCategories, campaigners, campaigns, db } from "@galangdana/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { toCampaignSummary } from "../lib/campaign-response";

const DEFAULT_LIMIT = 12;

export const campaignsRoute = new Elysia().get(
  "/campaigns",
  async ({ query, set }) => {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    const conditions = [eq(campaigns.status, "active")];
    if (query.category) {
      const [category] = await db
        .select()
        .from(campaignCategories)
        .where(eq(campaignCategories.slug, query.category));
      if (!category) {
        set.status = 404;
        return { error: "category_not_found" };
      }
      conditions.push(eq(campaigns.categoryId, category.id));
    }
    if (query.campaignerType) {
      conditions.push(eq(campaigners.type, query.campaignerType));
    }

    // "urgent": goal-model campaigns with the soonest deadline first;
    // program-model campaigns (expiresAt is always NULL for them) sort
    // last, since "urgency" has no meaning without a deadline. NULLS
    // LAST is Postgres's default for ASC, but stated explicitly here so
    // the intent survives a future sort-expression refactor.
    const orderBy =
      query.sort === "urgent"
        ? [sql`${campaigns.expiresAt} ASC NULLS LAST`]
        : [desc(campaigns.publishedAt)];

    const whereClause = and(...conditions);

    const [rows, [{ count }]] = await Promise.all([
      db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(campaigns)
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(whereClause),
    ]);

    const summaries = await Promise.all(rows.map(toCampaignSummary));

    return {
      campaigns: summaries,
      page,
      totalPages: Math.max(1, Math.ceil(count / limit)),
      totalCount: count,
    };
  },
  {
    query: CampaignListQuerySchema,
    response: { 200: CampaignListResponseSchema, 404: CampaignErrorSchema },
  },
);
```

- [ ] **Step 6: Wire the route — modify `apps/api/src/index.ts`**

```ts
import { Elysia } from "elysia";
import { withApiResponseMapping } from "./response-mapper";
import { authRoute } from "./routes/auth";
import { campaignsRoute } from "./routes/campaigns";
import { healthRoute } from "./routes/health";

export const app = withApiResponseMapping(new Elysia())
  .use(healthRoute)
  .use(authRoute)
  .use(campaignsRoute);

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
```

- [ ] **Step 7: Ensure the imgproxy/media env vars are available to `apps/api`'s test run**

`apps/api`'s tests already read `DATABASE_URL`/`REDIS_URL` from the environment (Phase 0a/0b) — confirm the same mechanism (a local `.env` file loaded by Bun automatically, or CI's `env:` block) also carries `IMGPROXY_KEY`/`IMGPROXY_SALT`/`IMGPROXY_BASE_URL`/`MEDIA_SOURCE_BASE_URL` (added to `.env.example` in Task 3). If `apps/api`'s tests currently run against a `.env` file that predates Task 3, copy the new keys from `.env.example` into the real local `.env` before running this task's tests.

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: PASS — 6 tests. (Requires Task 1/2's seed data and Task 3's imgproxy container to already be running locally.)

- [ ] **Step 9: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean, no regression in Phase 0b's existing auth tests.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add GET /campaigns list endpoint with category/type filter and urgent/newest sort"
```

---

## Task 7: `GET /campaigns/:slug` — campaign detail

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `toCampaignSummary` from Task 6's `campaign-response.ts` (extended, not replaced).
- Produces: `GET /campaigns/:slug` returning `CampaignDetailResponse` (the summary shape plus `story`).

- [ ] **Step 1: Extend `toCampaignSummary` into a detail mapper — modify `apps/api/src/lib/campaign-response.ts`**

Add, after the existing `toCampaignSummary` function:

```ts
export async function toCampaignDetail(row: CampaignRow) {
  const summary = await toCampaignSummary(row);
  return { ...summary, story: row.campaign.story };
}
```

- [ ] **Step 2: Write the failing test — extend `apps/api/src/routes/campaigns.test.ts`**

Add a new `describe` block:

```ts
describe("GET /campaigns/:slug", () => {
  test("returns full campaign detail including story, for a known seeded slug", async () => {
    const resp = await app.handle(
      new Request("http://localhost/campaigns/bantu-korban-banjir-bandang-kalimantan-selatan"),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { title: string; story: string; model: string };
    expect(body.title).toContain("Banjir Bandang");
    expect(body.story.length).toBeGreaterThan(0);
    expect(body.model).toBe("goal");
  });

  test("a program-model campaign has a null goalAmount/expiresAt and a nonzero availableAmount", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns/program-amil-zakat-mitra"));
    const body = (await resp.json()) as {
      model: string;
      goalAmount: unknown;
      expiresAt: unknown;
      availableAmount: { amount: string };
    };
    expect(body.model).toBe("program");
    expect(body.goalAmount).toBeNull();
    expect(body.expiresAt).toBeNull();
    expect(BigInt(body.availableAmount.amount)).toBeGreaterThan(0n);
  });

  test("returns 404 for an unknown slug", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns/does-not-exist"));
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: the 3 new tests FAIL (route doesn't exist), the 6 from Task 6 still PASS.

- [ ] **Step 4: Add the detail route — modify `apps/api/src/routes/campaigns.ts`**

Add the import:

```ts
import { CampaignDetailSchema, CampaignErrorSchema, CampaignListQuerySchema, CampaignListResponseSchema } from "@galangdana/contracts";
import { toCampaignDetail, toCampaignSummary } from "../lib/campaign-response";
```

Add a second route to the chain (Elysia routes chain fluently — append `.get("/campaigns/:slug", ...)` after the existing `.get("/campaigns", ...)` on the same `campaignsRoute` instance, do not create a second `new Elysia()`):

```ts
  .get(
    "/campaigns/:slug",
    async ({ params, set }) => {
      const [row] = await db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(and(eq(campaigns.slug, params.slug), eq(campaigns.status, "active")));

      if (!row) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      return toCampaignDetail(row);
    },
    { response: { 200: CampaignDetailSchema, 404: CampaignErrorSchema } },
  );
```

(The trailing semicolon moves from the end of the `/campaigns` route to the end of this new `/campaigns/:slug` route, since they're now one fluent chain — the existing route's own closing no longer ends with `;`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: PASS — 9 tests total.

- [ ] **Step 6: Run the full suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add GET /campaigns/:slug detail endpoint"
```

---

## Task 8: `GET /search` — Meilisearch-backed campaign search

**Files:**
- Create: `apps/api/src/routes/search.ts`
- Test: `apps/api/src/routes/search.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/package.json` (add `@galangdana/search`)

**Interfaces:**
- Consumes: `searchCampaigns` from `@galangdana/search`; `toCampaignSummary` from Task 6 (search results are re-hydrated from Postgres by slug, not served directly from the Meilisearch document shape — see Step 3's reasoning).
- Produces: `searchRoute` mounted at `GET /search`.

- [ ] **Step 1: Add `@galangdana/search` as an `apps/api` dependency**

Modify `apps/api/package.json`, adding to `dependencies`:

```json
"@galangdana/search": "workspace:*",
```

Run `bun install` from the repo root.

- [ ] **Step 2: Write the failing test — `apps/api/src/routes/search.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { app } from "../index";

describe("GET /search", () => {
  test("returns campaigns matching a typo-tolerant query, with the full summary shape (not the bare search-index shape)", async () => {
    const resp = await app.handle(new Request("http://localhost/search?q=banjr%20kalimantan")); // deliberate typo
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      results: Array<{ slug: string; coverImageUrl: string; collectedAmount: { amount: string } }>;
      query: string;
    };
    expect(body.results.some((r) => r.slug === "bantu-korban-banjir-bandang-kalimantan-selatan")).toBe(true);
    // Confirms results are re-hydrated to the full CampaignSummary shape
    // (imgproxy URL, MoneyJSON amounts) rather than returning the
    // Meilisearch index's own bare document shape, which has neither.
    expect(body.results[0]?.coverImageUrl).toMatch(/^http:\/\/localhost:8090\//);
  });

  test("returns an empty result set for a query matching nothing, not an error", async () => {
    const resp = await app.handle(new Request("http://localhost/search?q=xyzxyzxyznomatch"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  test("400s on a missing q parameter", async () => {
    const resp = await app.handle(new Request("http://localhost/search"));
    expect(resp.status).toBe(422); // TypeBox validation failure on the required, minLength:1 `q` field
  });
});
```

- [ ] **Step 3: Implement `apps/api/src/routes/search.ts`**

Meilisearch's own document shape (`CampaignSearchDocument`) is intentionally thin (just what's needed for indexing/filtering) — it has neither an imgproxy-signed cover image URL nor `MoneyJSON` amounts. Rather than duplicating that logic into the search index document, this route re-queries Postgres for the matched slugs and reuses `toCampaignSummary`, so search results and list results are always built by exactly one code path.

```ts
import { SearchQuerySchema, SearchResponseSchema } from "@galangdana/contracts";
import { campaignCategories, campaigners, campaigns, db } from "@galangdana/db";
import { searchCampaigns } from "@galangdana/search";
import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { toCampaignSummary } from "../lib/campaign-response";

export const searchRoute = new Elysia().get(
  "/search",
  async ({ query }) => {
    let categoryId: number | undefined;
    if (query.category) {
      const [category] = await db
        .select()
        .from(campaignCategories)
        .where(eq(campaignCategories.slug, query.category));
      categoryId = category?.id;
    }

    const hits = await searchCampaigns(query.q, { categoryId });
    if (hits.length === 0) {
      return { results: [], query: query.q };
    }

    const rows = await db
      .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
      .from(campaigns)
      .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
      .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
      .where(
        inArray(
          campaigns.id,
          hits.map((h) => h.id),
        ),
      );

    // Preserve Meilisearch's own relevance ordering -- the Postgres
    // inArray() query above has no guaranteed row order, so re-sort the
    // hydrated rows to match the order `hits` came back in.
    const orderById = new Map(hits.map((h, i) => [h.id, i]));
    const orderedRows = [...rows].sort(
      (a, b) => (orderById.get(a.campaign.id) ?? 0) - (orderById.get(b.campaign.id) ?? 0),
    );

    const results = await Promise.all(orderedRows.map(toCampaignSummary));
    return { results, query: query.q };
  },
  { query: SearchQuerySchema, response: { 200: SearchResponseSchema } },
);
```

- [ ] **Step 4: Wire the route — modify `apps/api/src/index.ts`**

```ts
import { Elysia } from "elysia";
import { withApiResponseMapping } from "./response-mapper";
import { authRoute } from "./routes/auth";
import { campaignsRoute } from "./routes/campaigns";
import { healthRoute } from "./routes/health";
import { searchRoute } from "./routes/search";

export const app = withApiResponseMapping(new Elysia())
  .use(healthRoute)
  .use(authRoute)
  .use(campaignsRoute)
  .use(searchRoute);

export type App = typeof app;

if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? 3001);
  app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
```

- [ ] **Step 5: Confirm the Meilisearch index is populated before running this task's tests**

Run: `cd packages/search && bun run reindex` (idempotent — safe to re-run; Task 4 already ran this once, but confirm it's current if any seed data changed since).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/search.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 7: Run the full suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add GET /search Meilisearch-backed campaign search"
```

---

## Task 9: `CampaignCard` component

**Files:**
- Create: `packages/ui/src/components/CampaignCard.svelte`
- Test: `packages/ui/src/components/CampaignCard.test.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Badge`, `Card` from Phase 0c's `packages/ui`; `formatMoney` from `@galangdana/money`.
- Produces: `CampaignCard` (`campaign: CampaignSummaryLike` — a local, minimal interface shape matching the API's `CampaignSummaryResponse`, so `packages/ui` doesn't need a dependency on `@galangdana/contracts` for one prop type), consumed by Tasks 10-13's SSR pages.

- [ ] **Step 1: Add `@galangdana/money` as a `packages/ui` dependency**

Modify `packages/ui/package.json`, adding to `dependencies`:

```json
"@galangdana/money": "workspace:*",
```

Run `bun install` from the repo root.

- [ ] **Step 2: Write the failing test — `packages/ui/src/components/CampaignCard.test.ts`**

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import CampaignCard from "./CampaignCard.svelte";

afterEach(() => cleanup());

const GOAL_CAMPAIGN = {
  slug: "test-goal-campaign",
  title: "Bantu Korban Banjir",
  shortDescription: "Ratusan keluarga membutuhkan bantuan",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 22, slug: "bencana-alam", title: "Bencana Alam" },
  campaigner: { id: "c1", type: "yayasan" as const, displayName: "Yayasan Test", avatarUrl: null, verified: true },
  model: "goal" as const,
  goalAmount: { amount: "100000000", currency: "IDR" as const },
  collectedAmount: { amount: "45000000", currency: "IDR" as const },
  availableAmount: { amount: "45000000", currency: "IDR" as const },
  donationCount: 120,
  expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

const PROGRAM_CAMPAIGN = {
  ...GOAL_CAMPAIGN,
  slug: "test-program-campaign",
  title: "Program Zakat Berkelanjutan",
  model: "program" as const,
  goalAmount: null,
  expiresAt: null,
  availableAmount: { amount: "200000000", currency: "IDR" as const },
};

describe("CampaignCard", () => {
  test("a goal-model campaign shows a progress bar and 'Terkumpul dari {target}'", () => {
    render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    expect(screen.getByText("Bantu Korban Banjir")).not.toBeNull();
    expect(screen.getByText(/Terkumpul dari/)).not.toBeNull();
    expect(screen.getByRole("progressbar")).not.toBeNull();
  });

  test("a program-model campaign shows 'Donasi tersedia' and no progress bar", () => {
    render(CampaignCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    expect(screen.getByText("Program Zakat Berkelanjutan")).not.toBeNull();
    expect(screen.getByText(/Donasi tersedia/)).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("renders the campaigner's display name and category title", () => {
    render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    expect(screen.getByText("Yayasan Test")).not.toBeNull();
    expect(screen.getByText("Bencana Alam")).not.toBeNull();
  });

  test("formats the collected amount using id-ID Rupiah grouping via @galangdana/money", () => {
    render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    // formatMoney({amount: 45000000n, currency: "IDR"}) -> "Rp45.000.000" (id-ID grouping)
    expect(screen.getByText("Rp45.000.000")).not.toBeNull();
  });

  test("links to the campaign detail page via its slug", () => {
    const { container } = render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/campaign/test-goal-campaign");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/ui && bun x vitest run src/components/CampaignCard.test.ts`
Expected: FAIL — `Failed to resolve import "./CampaignCard.svelte"`.

- [ ] **Step 4: Implement `packages/ui/src/components/CampaignCard.svelte`**

```svelte
<script lang="ts">
import { formatMoney, type MoneyJSON, moneyFromJSON } from "@galangdana/money";
import Badge from "./Badge.svelte";
import Card from "./Card.svelte";

interface CampaignSummaryLike {
  slug: string;
  title: string;
  shortDescription: string;
  coverImageUrl: string;
  category: { id: number; slug: string; title: string };
  campaigner: { id: string; type: "individual" | "yayasan" | "platform"; displayName: string; avatarUrl: string | null; verified: boolean };
  model: "goal" | "program";
  goalAmount: MoneyJSON | null;
  collectedAmount: MoneyJSON;
  availableAmount: MoneyJSON;
  donationCount: number;
  expiresAt: string | null;
  publishedAt: string;
}

interface Props {
  campaign: CampaignSummaryLike;
}

const { campaign }: Props = $props();

const collected = $derived(moneyFromJSON(campaign.collectedAmount));
const available = $derived(moneyFromJSON(campaign.availableAmount));
const goal = $derived(campaign.goalAmount ? moneyFromJSON(campaign.goalAmount) : null);

const progressPercent = $derived.by(() => {
  if (campaign.model !== "goal" || !goal || goal.amount === 0n) return 0;
  const pct = Number((collected.amount * 100n) / goal.amount);
  return Math.min(100, Math.max(0, pct));
});
</script>

<a href="/campaign/{campaign.slug}" class="block">
  <Card padded={false}>
    <img
      src={campaign.coverImageUrl}
      alt={campaign.title}
      class="aspect-[4/3] w-full rounded-t-md object-cover"
      loading="lazy"
    />
    <div class="p-4">
      <Badge variant="neutral">{campaign.category.title}</Badge>
      <h3 class="mt-2 font-sans text-base font-semibold text-neutral-900 line-clamp-2">
        {campaign.title}
      </h3>
      <p class="mt-1 font-sans text-sm text-neutral-600">{campaign.campaigner.displayName}</p>

      {#if campaign.model === "goal"}
        <div class="mt-3">
          <div
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            class="h-2 w-full overflow-hidden rounded-full bg-neutral-100"
          >
            <div class="h-full rounded-full bg-primary" style="width: {progressPercent}%"></div>
          </div>
          <p class="mt-2 font-sans text-sm font-semibold text-neutral-900">{formatMoney(collected)}</p>
          <p class="font-sans text-xs text-neutral-600">Terkumpul dari {formatMoney(goal ?? collected)}</p>
        </div>
      {:else}
        <div class="mt-3">
          <p class="font-sans text-sm font-semibold text-neutral-900">{formatMoney(available)}</p>
          <p class="font-sans text-xs text-neutral-600">Donasi tersedia</p>
        </div>
      {/if}
    </div>
  </Card>
</a>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/ui && bun x vitest run src/components/CampaignCard.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Update the barrel — `packages/ui/src/index.ts`**

Add, alongside the existing exports:

```ts
export { default as CampaignCard } from "./components/CampaignCard.svelte";
```

- [ ] **Step 7: Run the full `packages/ui` suite, lint, typecheck**

Run: `cd packages/ui && bun x vitest run && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add CampaignCard component with goal/program dual-model display"
```

---

## Task 10: Home page — SSR campaign feed and category quick-nav

**Files:**
- Modify: `apps/web/src/routes/(consumer)/+page.ts`
- Modify: `apps/web/src/routes/(consumer)/+page.svelte`
- Modify: `apps/web/src/routes/(consumer)/page.test.ts`
- Modify: `apps/web/src/routes/(consumer)/page.render.test.ts`

**Interfaces:**
- Consumes: `CampaignCard` from `@galangdana/ui`; `api.campaigns.get(...)` via the existing Eden Treaty client (verified calling convention: `client.campaigns.get({ query: {...} })` for a plain route with query params).
- Produces: the real homepage, replacing Phase 0c's health-check placeholder content with a real campaign feed. The `apiStatus` health-check display from Phase 0c is removed — this task's own test coverage replaces Phase 0c's health-focused assertions with feed-focused ones (the health check itself is not deleted from the API, just no longer the homepage's headline content).

- [ ] **Step 1: Write the failing test for the load function — modify `apps/web/src/routes/(consumer)/page.test.ts`**

Replace the file's contents (the existing health-check-only test no longer matches what this page loads):

```ts
import { describe, expect, test, vi } from "vitest";

describe("home page load", () => {
  test("fetches a campaign feed and the category list, and passes both to the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/campaigns?")) {
          return new Response(
            JSON.stringify({
              campaigns: [{ slug: "test-campaign", title: "Test Campaign" }],
              page: 1,
              totalPages: 1,
              totalCount: 1,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch to ${url}`);
      }),
    );

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect(result.campaigns).toEqual([{ slug: "test-campaign", title: "Test Campaign" }]);
  });

  test("falls back to an empty feed, without throwing, when the API connection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Unable to connect. Is the computer able to access the url?");
      }),
    );

    const { load } = await import("./+page");
    const result = await load({ fetch: globalThis.fetch } as never);

    expect(result.campaigns).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run src/routes/\(consumer\)/page.test.ts`
Expected: FAIL — `+page.ts` still only loads `apiStatus`/`apiService`.

- [ ] **Step 3: Implement the load function — modify `apps/web/src/routes/(consumer)/+page.ts`**

```ts
import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  try {
    const { data } = await api.campaigns.get({ query: { sort: "newest", limit: 8 } });
    return { campaigns: data?.campaigns ?? [] };
  } catch {
    return { campaigns: [] };
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run src/routes/\(consumer\)/page.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Restyle the homepage — modify `apps/web/src/routes/(consumer)/+page.svelte`**

```svelte
<script lang="ts">
import { CampaignCard } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="flex flex-col gap-6">
  <div>
    <h1 class="font-sans text-2xl font-bold text-neutral-900">Galang kebaikan bersama</h1>
    <p class="mt-1 font-sans text-neutral-600">
      Bantu sesama melalui donasi yang tepat sasaran dan transparan.
    </p>
  </div>

  {#if data.campaigns.length > 0}
    <div class="grid grid-cols-1 gap-4">
      {#each data.campaigns as campaign (campaign.slug)}
        <CampaignCard {campaign} />
      {/each}
    </div>
  {:else}
    <p class="font-sans text-neutral-600">Belum ada campaign yang bisa ditampilkan saat ini.</p>
  {/if}
</div>
```

- [ ] **Step 6: Update the rendering test — modify `apps/web/src/routes/(consumer)/page.render.test.ts`**

Replace the file's contents (the Phase 0c version tested `apiStatus`/Badge rendering, which this page no longer shows):

```ts
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Test Campaign",
  shortDescription: "A test campaign",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 1, slug: "test", title: "Test Category" },
  campaigner: { id: "c1", type: "individual" as const, displayName: "Test Campaigner", avatarUrl: null, verified: false },
  model: "goal" as const,
  goalAmount: { amount: "1000000", currency: "IDR" as const },
  collectedAmount: { amount: "500000", currency: "IDR" as const },
  availableAmount: { amount: "500000", currency: "IDR" as const },
  donationCount: 10,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

afterEach(() => cleanup());

describe("(consumer) homepage rendering", () => {
  test("renders a campaign card for each campaign in the feed", () => {
    render(Page, { props: { data: { campaigns: [SAMPLE_CAMPAIGN] } } });
    expect(screen.getByText("Test Campaign")).not.toBeNull();
    expect(screen.getByText("Test Campaigner")).not.toBeNull();
  });

  test("shows an empty-state message when the feed is empty", () => {
    render(Page, { props: { data: { campaigns: [] } } });
    expect(screen.getByText(/Belum ada campaign/)).not.toBeNull();
  });
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run src/routes/\(consumer\)/page.render.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 8: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): restyle the homepage as a real SSR campaign feed"
```

---

## Task 11: Explore page — `/explore/[category]`

**Files:**
- Create: `apps/web/src/routes/(consumer)/explore/[category]/+page.ts`
- Create: `apps/web/src/routes/(consumer)/explore/[category]/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/explore/[category]/page.render.test.ts`

**Interfaces:**
- Consumes: `CampaignCard` from `@galangdana/ui`; `api.campaigns.get({query: {category, sort, campaignerType}})`.
- Produces: `/explore/[category]` — a filtered, sorted campaign list for one category, with a sort toggle (urgent/newest) and a campaigner-type filter (all/individual/yayasan/platform — matching the master spec's observed "Kitabisa / Yayasan / Publik" facet), both as query params on the same route, not separate path segments.

- [ ] **Step 1: Implement the load function — `apps/web/src/routes/(consumer)/explore/[category]/+page.ts`**

```ts
import { api } from "$lib/api-client";
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

const CAMPAIGNER_TYPES = ["individual", "yayasan", "platform"] as const;
type CampaignerType = (typeof CAMPAIGNER_TYPES)[number];

function parseCampaignerType(value: string | null): CampaignerType | undefined {
  return CAMPAIGNER_TYPES.includes(value as CampaignerType) ? (value as CampaignerType) : undefined;
}

export const load: PageLoad = async ({ params, url }) => {
  const sort = url.searchParams.get("sort") === "urgent" ? "urgent" : "newest";
  const campaignerType = parseCampaignerType(url.searchParams.get("type"));

  // The campaignerType key is spread in conditionally, NOT written as
  // `campaignerType: campaignerType ?? undefined` -- verified empirically
  // against this repo's installed Eden Treaty/Elysia versions that a query
  // object value of `undefined` is NOT the same as an absent key: Eden
  // serializes an explicit `undefined` property value as the literal
  // string "undefined" on the wire, which would then fail
  // CampaignListQuerySchema's enum-literal validation (422) on every
  // explore-page visit that doesn't pick a specific type filter. Omitting
  // the key entirely is the only form that reaches the server as a
  // genuinely absent/undefined value.
  const { data, error: apiError } = await api.campaigns.get({
    query: {
      category: params.category,
      sort,
      limit: 24,
      ...(campaignerType ? { campaignerType } : {}),
    },
  });

  if (apiError?.status === 404) {
    error(404, "Kategori tidak ditemukan");
  }

  return {
    category: params.category,
    sort,
    campaignerType: campaignerType ?? null,
    campaigns: data?.campaigns ?? [],
    totalCount: data?.totalCount ?? 0,
  };
};
```

- [ ] **Step 2: Implement the page — `apps/web/src/routes/(consumer)/explore/[category]/+page.svelte`**

```svelte
<script lang="ts">
import { CampaignCard } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const CAMPAIGNER_TYPE_LABELS = {
  individual: "Publik",
  yayasan: "Yayasan",
  platform: "Program Mitra",
} as const;

// Each toggle link must preserve the OTHER active filter -- a bare
// `href="?sort=urgent"` would silently drop an active `type=` filter
// (and vice versa) since it replaces the whole query string, not just
// one param.
function filterHref(overrides: { sort?: string; type?: string | null }): string {
  const params = new URLSearchParams();
  params.set("sort", overrides.sort ?? data.sort);
  const type = overrides.type !== undefined ? overrides.type : data.campaignerType;
  if (type) params.set("type", type);
  return `?${params.toString()}`;
}
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h1 class="font-sans text-xl font-bold capitalize text-neutral-900">
      {data.category.replaceAll("-", " ")}
    </h1>
    <div class="flex gap-2 font-sans text-sm">
      <a
        href={filterHref({ sort: "newest" })}
        class={data.sort === "newest" ? "font-semibold text-primary" : "text-neutral-600"}
      >
        Terbaru
      </a>
      <a
        href={filterHref({ sort: "urgent" })}
        class={data.sort === "urgent" ? "font-semibold text-primary" : "text-neutral-600"}
      >
        Paling Mendesak
      </a>
    </div>
  </div>

  <div class="flex gap-2 font-sans text-sm">
    <a
      href={filterHref({ type: null })}
      class={data.campaignerType === null ? "font-semibold text-primary" : "text-neutral-600"}
    >
      Semua
    </a>
    {#each Object.entries(CAMPAIGNER_TYPE_LABELS) as [type, label] (type)}
      <a
        href={filterHref({ type })}
        class={data.campaignerType === type ? "font-semibold text-primary" : "text-neutral-600"}
      >
        {label}
      </a>
    {/each}
  </div>

  <p class="font-sans text-sm text-neutral-600">{data.totalCount} campaign ditemukan</p>

  {#if data.campaigns.length > 0}
    <div class="grid grid-cols-1 gap-4">
      {#each data.campaigns as campaign (campaign.slug)}
        <CampaignCard {campaign} />
      {/each}
    </div>
  {:else}
    <p class="font-sans text-neutral-600">Belum ada campaign di kategori ini.</p>
  {/if}
</div>
```

- [ ] **Step 3: Write the rendering test — `apps/web/src/routes/(consumer)/explore/[category]/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Test Campaign",
  shortDescription: "A test campaign",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
  campaigner: { id: "c1", type: "individual" as const, displayName: "Test Campaigner", avatarUrl: null, verified: false },
  model: "goal" as const,
  goalAmount: { amount: "1000000", currency: "IDR" as const },
  collectedAmount: { amount: "500000", currency: "IDR" as const },
  availableAmount: { amount: "500000", currency: "IDR" as const },
  donationCount: 10,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

describe("(consumer) explore/[category] rendering", () => {
  test("renders the category name, count, and each campaign card", () => {
    render(Page, {
      props: {
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: null,
          campaigns: [SAMPLE_CAMPAIGN],
          totalCount: 1,
        },
      },
    });
    expect(screen.getByText("bencana alam")).not.toBeNull();
    expect(screen.getByText("1 campaign ditemukan")).not.toBeNull();
    expect(screen.getByText("Test Campaign")).not.toBeNull();
  });

  test("highlights the active sort option", () => {
    render(Page, {
      props: {
        data: { category: "bencana-alam", sort: "urgent", campaignerType: null, campaigns: [], totalCount: 0 },
      },
    });
    const urgentLink = screen.getByText("Paling Mendesak");
    expect(urgentLink.className).toContain("text-primary");
  });

  test("highlights 'Semua' by default and the matching type label when a type filter is active", () => {
    const { unmount } = render(Page, {
      props: {
        data: { category: "bencana-alam", sort: "newest", campaignerType: null, campaigns: [], totalCount: 0 },
      },
    });
    expect(screen.getByText("Semua").className).toContain("text-primary");
    unmount();

    render(Page, {
      props: {
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: "yayasan",
          campaigns: [],
          totalCount: 0,
        },
      },
    });
    expect(screen.getByText("Yayasan").className).toContain("text-primary");
    expect(screen.getByText("Semua").className).not.toContain("text-primary");
  });

  test("a sort link preserves the active type filter in its href", () => {
    render(Page, {
      props: {
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: "platform",
          campaigns: [],
          totalCount: 0,
        },
      },
    });
    const urgentLink = screen.getByText("Paling Mendesak") as HTMLAnchorElement;
    expect(urgentLink.getAttribute("href")).toBe("?sort=urgent&type=platform");
  });

  test("shows an empty-state message when no campaigns match", () => {
    render(Page, {
      props: {
        data: { category: "bencana-alam", sort: "newest", campaignerType: null, campaigns: [], totalCount: 0 },
      },
    });
    expect(screen.getByText(/Belum ada campaign di kategori ini/)).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/explore/[category]/page.render.test.ts"`
Expected: PASS — 5 tests.

- [ ] **Step 5: Manually verify the load function against the real running API**

Since this route has no `page.test.ts` of its own (its load logic is thin enough that the render test plus Task 6's own API-level category/404 tests already cover the meaningful behavior — a third redundant test layer here would be the kind of test-for-test's-sake this plan's Global Constraints steer away from), verify it once by hand: with `apps/api` and `apps/web` both running locally, visit `http://localhost:5173/explore/bencana-alam` and `http://localhost:5173/explore/does-not-exist`, confirming the first shows real seeded campaigns and the second renders SvelteKit's 404 error page.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add /explore/[category] page with urgent/newest sort"
```

---

## Task 12: Campaign detail page — `/campaign/[slug]`

**Files:**
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/+page.ts`
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/page.render.test.ts`

**Interfaces:**
- Consumes: `Badge`, `Card` from `@galangdana/ui`; `formatMoney`/`moneyFromJSON` from `@galangdana/money`; `api.campaigns({slug}).get()` (verified calling convention for a dynamic path segment).
- Produces: `/campaign/[slug]` — the full detail view, rendering the `goal` and `program` models with genuinely different layouts (progress bar + deadline countdown vs. available-balance display, matching this plan's Global Constraints and the master spec's observed semantics).

- [ ] **Step 1: Implement the load function — `apps/web/src/routes/(consumer)/campaign/[slug]/+page.ts`**

```ts
import { api } from "$lib/api-client";
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
  const { data, error: apiError } = await api.campaigns({ slug: params.slug }).get();

  if (apiError?.status === 404 || !data) {
    error(404, "Campaign tidak ditemukan");
  }

  return { campaign: data };
};
```

- [ ] **Step 2: Implement the page — `apps/web/src/routes/(consumer)/campaign/[slug]/+page.svelte`**

```svelte
<script lang="ts">
import { Badge, Card } from "@galangdana/ui";
import { formatMoney, moneyFromJSON } from "@galangdana/money";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
const campaign = $derived(data.campaign);

const collected = $derived(moneyFromJSON(campaign.collectedAmount));
const available = $derived(moneyFromJSON(campaign.availableAmount));
const goal = $derived(campaign.goalAmount ? moneyFromJSON(campaign.goalAmount) : null);

const progressPercent = $derived.by(() => {
  if (campaign.model !== "goal" || !goal || goal.amount === 0n) return 0;
  const pct = Number((collected.amount * 100n) / goal.amount);
  return Math.min(100, Math.max(0, pct));
});

const daysLeft = $derived.by(() => {
  if (!campaign.expiresAt) return null;
  const ms = new Date(campaign.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
});
</script>

<div class="flex flex-col gap-4">
  <img
    src={campaign.coverImageUrl}
    alt={campaign.title}
    class="aspect-[4/3] w-full rounded-md object-cover"
  />

  <Badge variant="neutral">{campaign.category.title}</Badge>
  <h1 class="font-sans text-xl font-bold text-neutral-900">{campaign.title}</h1>
  <p class="font-sans text-sm text-neutral-600">
    Digalang oleh <span class="font-medium">{campaign.campaigner.displayName}</span>
    {#if campaign.campaigner.verified}
      <span class="text-primary">&middot; Terverifikasi</span>
    {/if}
  </p>

  <Card>
    {#if campaign.model === "goal"}
      <div
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        class="h-2 w-full overflow-hidden rounded-full bg-neutral-100"
      >
        <div class="h-full rounded-full bg-primary" style="width: {progressPercent}%"></div>
      </div>
      <p class="mt-3 font-sans text-lg font-bold text-neutral-900">{formatMoney(collected)}</p>
      <p class="font-sans text-sm text-neutral-600">Terkumpul dari {formatMoney(goal ?? collected)}</p>
      {#if daysLeft !== null}
        <p class="mt-2 font-sans text-sm text-neutral-600">{daysLeft} hari lagi</p>
      {/if}
    {:else}
      <p class="font-sans text-lg font-bold text-neutral-900">{formatMoney(available)}</p>
      <p class="font-sans text-sm text-neutral-600">Donasi tersedia</p>
    {/if}
    <p class="mt-2 font-sans text-sm text-neutral-600">{campaign.donationCount} donatur</p>
  </Card>

  <div class="font-sans text-neutral-900">
    <h2 class="mb-2 text-lg font-semibold">Cerita Campaign</h2>
    <p class="whitespace-pre-line text-sm leading-relaxed">{campaign.story}</p>
  </div>
</div>
```

- [ ] **Step 3: Write the rendering test — `apps/web/src/routes/(consumer)/campaign/[slug]/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const GOAL_CAMPAIGN = {
  id: "1",
  slug: "test-goal",
  title: "Test Goal Campaign",
  shortDescription: "desc",
  story: "Ini adalah cerita lengkap campaign.",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
  campaigner: { id: "c1", type: "yayasan" as const, displayName: "Yayasan Test", avatarUrl: null, verified: true },
  model: "goal" as const,
  goalAmount: { amount: "1000000", currency: "IDR" as const },
  collectedAmount: { amount: "500000", currency: "IDR" as const },
  availableAmount: { amount: "500000", currency: "IDR" as const },
  donationCount: 42,
  expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

const PROGRAM_CAMPAIGN = {
  ...GOAL_CAMPAIGN,
  slug: "test-program",
  title: "Test Program Campaign",
  model: "program" as const,
  goalAmount: null,
  expiresAt: null,
  availableAmount: { amount: "9000000", currency: "IDR" as const },
};

describe("(consumer) campaign/[slug] rendering", () => {
  test("a goal-model campaign shows the progress bar, days-left, and 'Terkumpul dari'", () => {
    render(Page, { props: { data: { campaign: GOAL_CAMPAIGN } } });
    expect(screen.getByText("Test Goal Campaign")).not.toBeNull();
    expect(screen.getByRole("progressbar")).not.toBeNull();
    expect(screen.getByText(/Terkumpul dari/)).not.toBeNull();
    expect(screen.getByText("5 hari lagi")).not.toBeNull();
  });

  test("a program-model campaign shows 'Donasi tersedia' with no progress bar and no days-left", () => {
    render(Page, { props: { data: { campaign: PROGRAM_CAMPAIGN } } });
    expect(screen.getByText("Test Program Campaign")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Donasi tersedia")).not.toBeNull();
    expect(screen.queryByText(/hari lagi/)).toBeNull();
  });

  test("shows a verified badge for a verified campaigner", () => {
    render(Page, { props: { data: { campaign: GOAL_CAMPAIGN } } });
    expect(screen.getByText(/Terverifikasi/)).not.toBeNull();
  });

  test("renders the full story text", () => {
    render(Page, { props: { data: { campaign: GOAL_CAMPAIGN } } });
    expect(screen.getByText("Ini adalah cerita lengkap campaign.")).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/campaign/[slug]/page.render.test.ts"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Manually verify against the real running API**

With `apps/api` and `apps/web` running locally, visit `http://localhost:5173/campaign/bantu-korban-banjir-bandang-kalimantan-selatan` (goal model) and `http://localhost:5173/campaign/program-amil-zakat-mitra` (program model), confirming each renders the correct layout and a real, correctly-sized image loads from imgproxy.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add /campaign/[slug] detail page rendering both campaign models"
```

---

## Task 13: Search results page — `/search`

**Files:**
- Create: `apps/web/src/routes/(consumer)/search/+page.ts`
- Create: `apps/web/src/routes/(consumer)/search/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/search/page.render.test.ts`

**Interfaces:**
- Consumes: `CampaignCard` from `@galangdana/ui`; `Label`, `TextInput` from `@galangdana/ui` (Phase 0c's form primitives, used here as a search box); `api.search.get({query: {q}})`.
- Produces: `/search?q=...` — a results page with a query input that resubmits via a GET form (no client-side JS required for the base case, matching SvelteKit's progressive-enhancement default for forms).

- [ ] **Step 1: Implement the load function — `apps/web/src/routes/(consumer)/search/+page.ts`**

```ts
import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return { query: "", results: [] };
  }

  try {
    const { data } = await api.search.get({ query: { q } });
    return { query: q, results: data?.results ?? [] };
  } catch {
    return { query: q, results: [] };
  }
};
```

- [ ] **Step 2: Implement the page — `apps/web/src/routes/(consumer)/search/+page.svelte`**

A plain HTML `<form method="GET">` (not a JS-driven `oninput` handler) is deliberate: it works with SvelteKit's SSR-first, progressively-enhanced default — a full page navigation on submit re-runs `+page.ts`'s `load`, no client-side fetch wiring needed for this phase.

```svelte
<script lang="ts">
import { CampaignCard } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="flex flex-col gap-4">
  <form method="GET" class="flex gap-2">
    <label for="search-q" class="sr-only">Cari campaign</label>
    <input
      id="search-q"
      name="q"
      type="text"
      value={data.query}
      placeholder="Cari campaign..."
      class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base
        focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
    <button
      type="submit"
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark"
    >
      Cari
    </button>
  </form>

  {#if data.query}
    <p class="font-sans text-sm text-neutral-600">
      {data.results.length} hasil untuk "{data.query}"
    </p>
  {/if}

  {#if data.results.length > 0}
    <div class="grid grid-cols-1 gap-4">
      {#each data.results as campaign (campaign.slug)}
        <CampaignCard {campaign} />
      {/each}
    </div>
  {:else if data.query}
    <p class="font-sans text-neutral-600">Tidak ada campaign yang cocok dengan pencarian Anda.</p>
  {/if}
</div>
```

(This deliberately does not use Phase 0c's `Label`/`TextInput` components for the search box — those are designed around Svelte's `$bindable()` two-way binding for client-managed form state, which doesn't fit a plain GET-form-per-submission search box cleanly. Using the native `<input>`/`<label>` here, styled with the same token classes, is a better fit than forcing a component built for a different interaction pattern; this is a deliberate scope note, not an oversight, since Task 9's original interface list mentioned `TextInput` as a plausible import before this was actually built out.)

- [ ] **Step 3: Write the rendering test — `apps/web/src/routes/(consumer)/search/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Bantu Korban Banjir",
  shortDescription: "desc",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
  campaigner: { id: "c1", type: "individual" as const, displayName: "Test Campaigner", avatarUrl: null, verified: false },
  model: "goal" as const,
  goalAmount: { amount: "1000000", currency: "IDR" as const },
  collectedAmount: { amount: "500000", currency: "IDR" as const },
  availableAmount: { amount: "500000", currency: "IDR" as const },
  donationCount: 10,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

describe("(consumer) search rendering", () => {
  test("with no query, shows the search box and no results message", () => {
    render(Page, { props: { data: { query: "", results: [] } } });
    expect(screen.getByPlaceholderText("Cari campaign...")).not.toBeNull();
    expect(screen.queryByText(/hasil untuk/)).toBeNull();
  });

  test("with a query and results, shows the result count and each campaign card", () => {
    render(Page, { props: { data: { query: "banjir", results: [SAMPLE_CAMPAIGN] } } });
    expect(screen.getByText('1 hasil untuk "banjir"')).not.toBeNull();
    expect(screen.getByText("Bantu Korban Banjir")).not.toBeNull();
  });

  test("with a query and no results, shows a no-results message", () => {
    render(Page, { props: { data: { query: "xyznomatch", results: [] } } });
    expect(screen.getByText("0 hasil untuk \"xyznomatch\"")).not.toBeNull();
    expect(screen.getByText(/Tidak ada campaign yang cocok/)).not.toBeNull();
  });

  test("the search input's value reflects the current query (so resubmitting doesn't clear it)", () => {
    render(Page, { props: { data: { query: "banjir", results: [] } } });
    const input = screen.getByPlaceholderText("Cari campaign...") as HTMLInputElement;
    expect(input.value).toBe("banjir");
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/search/page.render.test.ts"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Manually verify against the real running API, including the typo-tolerance path**

With `apps/api` and `apps/web` running locally, visit `http://localhost:5173/search?q=banjr+kalimantan` (deliberate typo) and confirm the Kalimantan Selatan flood campaign appears in the results.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add /search results page backed by Meilisearch"
```

---

## Task 14: CI verification pass — docker-compose services, seed/reindex ordering, link check

**Files:**
- Modify: `.github/workflows/ci.yml` (add `imgproxy` service container, a seed + upload-images + reindex step sequence, and the corresponding env vars)

**Interfaces:**
- Consumes: everything from Tasks 1-13.
- Produces: a CI run that seeds real campaign/campaigner/image data and a real Meilisearch index before the app boots, so the existing link-check step (which crawls from `/`) now exercises real `/campaign/[slug]` and `/explore/[category]` links, not just the bare homepage — and add `/search?q=...` as an explicit extra crawl seed, since nothing on the homepage links to it yet.

- [ ] **Step 1: Add the `imgproxy` service container to `.github/workflows/ci.yml`**

Insert alongside the existing `postgres`/`redis` services block (CI's Meilisearch/MinIO needs assessed in Step 2 below — imgproxy itself needs no data volume, unlike Postgres/Redis, so it's added directly here):

```yaml
      imgproxy:
        image: darthsim/imgproxy:latest
        env:
          IMGPROXY_KEY: 4ac5d314cc578f0216d080c03b2bc517a7e4226af8a4ed6a5617cf94e44c554c
          IMGPROXY_SALT: 00325181fcb6c7a7ef94ba22eab86f3115ddfaf7178dcba96d19a327c0ab65f1
          IMGPROXY_ALLOW_LOOPBACK_SOURCE_ADDRESSES: "true"
        ports: ["8090:8080"]
```

Note: GitHub Actions `services:` containers don't support a `healthcheck.test` array the way `docker-compose.yml` does (the two use different schemas) — GitHub Actions instead uses `options: --health-cmd ...` for the same effect. Check whether imgproxy's own binary supports a `imgproxy health` subcommand suitable for `--health-cmd "imgproxy health"` (used in `docker-compose.yml`'s version, Task 3 Step 8); if the CI runner's imgproxy image doesn't expose that subcommand in a way `--health-cmd` can shell out to, omit the health option and rely on the existing "Wait for API"-style polling loop pattern (see the next step) instead — do not block the whole job on a healthcheck syntax that isn't verified to work in GitHub Actions' `services:` schema specifically.

- [ ] **Step 2: Add `meilisearch` and `minio` service containers**

Neither exists in `ci.yml` yet (only `postgres`/`redis` do, from Phase 0a/0b) — both are needed now that this phase's tests hit them for real. Mirror the existing `postgres`/`redis` blocks' style:

```yaml
      meilisearch:
        image: getmeili/meilisearch:v1.11
        env:
          MEILI_MASTER_KEY: galangdana-dev-master-key
          MEILI_NO_ANALYTICS: "true"
        ports: ["7700:7700"]
      minio:
        image: minio/minio:latest
        env:
          MINIO_ROOT_USER: galangdana
          MINIO_ROOT_PASSWORD: galangdana-dev-secret
        ports: ["9000:9000", "9001:9001"]
        options: >-
          --health-cmd "curl -f http://localhost:9000/minio/health/live"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
```

MinIO's Docker image needs an explicit `server /data` command to actually start serving — `docker-compose.yml`'s own `minio` service already sets this via `command:`, which the GitHub Actions `services:` schema has no equivalent field for. Check whether the plain `minio/minio:latest` image's default `ENTRYPOINT`/`CMD` already runs `server /data` without an explicit override (many published images set a sensible default `CMD` that only needs overriding for non-default behavior); if the service container fails to come up serving on port 9000, this is the first thing to check, and the fix is almost certainly `docker-compose.yml`'s own working `command: server /data --console-address ":9001"` translated into whatever mechanism GitHub Actions' `services:` schema actually supports for this (research this specifically if it's needed — do not guess at a workaround that hasn't been checked against GitHub's actual documented `services:` capabilities).

- [ ] **Step 3: Add environment variables to the job's `env:` block**

```yaml
      IMGPROXY_KEY: 4ac5d314cc578f0216d080c03b2bc517a7e4226af8a4ed6a5617cf94e44c554c
      IMGPROXY_SALT: 00325181fcb6c7a7ef94ba22eab86f3115ddfaf7178dcba96d19a327c0ab65f1
      IMGPROXY_BASE_URL: http://localhost:8090
      MEDIA_SOURCE_BASE_URL: http://localhost:9000/campaign-media
      MEDIA_S3_ENDPOINT: http://localhost:9000
      MEDIA_S3_ACCESS_KEY_ID: galangdana
      MEDIA_S3_SECRET_ACCESS_KEY: galangdana-dev-secret
      MEDIA_S3_BUCKET: campaign-media
      MEILISEARCH_URL: http://localhost:7700
      MEILISEARCH_API_KEY: galangdana-dev-master-key
```

- [ ] **Step 4: Add a bucket-creation + seed + reindex step sequence**

Insert after the existing `Run database migrations` step and before `Typecheck` (so the seed data exists before any test that queries it runs):

```yaml
      - name: Create media bucket
        run: |
          curl -X PUT http://galangdana:galangdana-dev-secret@localhost:9000/campaign-media || true
          # MinIO's anonymous-download policy needs the mc client, not a plain curl PUT --
          # if the bucket-creation step above doesn't also make it public-readable, the
          # subsequent seed/upload step's own bucket-existence check (see
          # packages/db/src/seed/upload-cover-images.ts) will fail loudly with clear
          # instructions rather than silently produce broken image URLs -- investigate
          # and fix this step for real rather than leaving the `|| true` as a permanent
          # workaround if it turns out this naive PUT doesn't actually create a usable bucket.

      - name: Seed database
        run: bun run db:seed
        working-directory: packages/db

      - name: Upload seed cover images
        run: bun run src/seed/upload-cover-images.ts
        working-directory: packages/db

      - name: Reindex search
        run: bun run reindex
        working-directory: packages/search
```

Flag this step sequence explicitly in your task report for the plan owner's attention: the "Create media bucket" step's exact mechanism was not empirically verified against a real GitHub Actions run during this plan's writing (unlike almost everything else in this plan, which was verified against a real local Docker/MinIO/imgproxy/Meilisearch setup) — the local dev instructions in Task 3 Step 11 use the `mc` Docker image, which isn't a natural fit for a single CI step. Get this working for real in CI (not just locally) as part of completing this task, and correct this step's implementation based on what actually works — this checkbox is not done until a real CI run seeds data and serves a real image through imgproxy successfully.

- [ ] **Step 5: Add `/search?q=banjir` as an explicit link-check seed**

`scripts/check-links.ts` only crawls same-origin `<a href>` links reachable from `/` — nothing on the homepage links to `/search` yet (Task 13's search box is a `<form>`, not an `<a href="/search">` link), so the crawler never reaches it on its own. Rather than adding a footer link purely to satisfy the crawler (the kind of workaround Phase 0c's Task 6 explicitly declined to do for the same reason), extend `scripts/check-links.ts` to accept extra seed paths:

Modify `scripts/check-links.ts`, changing the `queue` initialization:

```ts
const EXTRA_SEED_PATHS = (process.env.CHECK_LINKS_EXTRA_ROUTES ?? "").split(",").filter(Boolean);
const queue = ["/", ...EXTRA_SEED_PATHS];
```

Modify the `Link check` step in `ci.yml` to pass one:

```yaml
      - name: Link check
        run: bun run scripts/check-links.ts
        env:
          CHECK_LINKS_BASE_URL: http://localhost:5173
          CHECK_LINKS_EXTRA_ROUTES: /search?q=banjir
```

- [ ] **Step 6: Run the complete verification suite locally, exactly as CI will**

Run (from the repo root, with `docker compose up -d` already running all services including the new `imgproxy`):
```bash
bun install
bun run lint
bun run typecheck
cd packages/db && bun run db:migrate && bun run db:seed && bun run src/seed/upload-cover-images.ts && cd ../..
cd packages/search && bun run reindex && cd ../..
bun run test
cd apps/web && bun run test && cd ..
cd packages/ui && bun run test && cd ../..
bun run --cwd apps/web build
```
Expected: every command exits 0.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml scripts/check-links.ts
git commit -m "ci: provision imgproxy/meilisearch/minio, seed+reindex before tests, extend link check"
```

---

## Verification

- **Unit** (`bun test` across `packages/money`, `contracts`, `db`, `media`, `search`, `apps/api`; `vitest` across `packages/ui`, `apps/web`): every new schema, route, and component has a real test asserting actual behavior against real infrastructure (real Postgres, real Meilisearch, real MinIO/imgproxy) — no mocking of this plan's own new services, matching every earlier phase's established testing philosophy.
- **The two framework/infra gotchas this plan's own research found and pre-fixed** — Meilisearch's primary-key auto-inference silently failing on a document with two `...id` fields (Task 4), and imgproxy's `IMGPROXY_ALLOW_LOOPBACK_SOURCE_ADDRESSES` (plural) being required for a local MinIO source (Task 3) — are each backed by a regression test/comment at the exact spot a future edit could reintroduce them.
- **Dual-model correctness**: `CampaignCard` (Task 9) and the campaign detail page (Task 12) both have explicit tests asserting the `goal` and `program` models render genuinely different content (progress bar + "Terkumpul dari" vs. "Donasi tersedia", presence/absence of `role="progressbar"`), not just that both "don't crash."
- **Security**: the imgproxy signing key's confinement to `apps/api` (this plan's most safety-critical Global Constraint) is enforced by construction — no `+page.ts`/`+page.svelte` file in this entire plan imports `@galangdana/media` or reads `process.env.IMGPROXY_KEY`; grep for both as a final check before Task 14's commit.
- **CI**: real seed data, real uploaded images, and a real Meilisearch index all exist before the test/build/link-check steps run, so CI is exercising the same real, non-mocked path as local dev — not a CI-only fake.

## Risks

- **CI's MinIO/imgproxy bucket-provisioning step (Task 14 Step 4) is the one piece of this plan not empirically verified against a real GitHub Actions run during planning**, unlike everything else, which was checked against a real local Docker Compose stack. Flagged explicitly in that task's own steps — do not let it become a "probably fine" assumption; confirm it against a real CI run before considering Phase 1 done.
- **Eight seeded campaigns is enough to prove the pipeline, not enough to stress-test pagination, search relevance ranking, or explore-page density at realistic scale.** Fine for this phase (which is about proving the pipeline works end to end); a future phase adding real campaign creation will naturally grow this past the point where seed-fixture realism matters.
- **The `campaigners` table is real but intentionally shallow** (Task 1's own comment states this) — no auth linkage, no verification workflow. Phase 5 will need to decide how an authenticated `users` account becomes (or claims) a `campaigners` row; this plan does not attempt to answer that now, and building campaign creation (Phase 4) before that decision is made would be building on a still-open question.
- **`packages/media`'s dev key/salt are checked into `.env.example` and `docker-compose.yml` in plaintext** (Task 3 Step 9 explains why this is an acceptable, deliberate choice for local-dev-only infrastructure with no real user data behind it, matching the existing `MINIO_ROOT_PASSWORD` precedent) — a real deployment must generate and manage its own via whatever secrets mechanism the eventual hosting environment uses; this plan does not address deployment secrets management, which is out of scope for every phase so far.
