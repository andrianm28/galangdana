# Phase 2a: Creation Wizard — Draft + Guided Story Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the draft-first campaign creation wizard's core: draft lifecycle, the guided
story builder for both tracks (medical/non-medical), patient/beneficiary data collection, and
evidentiary document upload — everything up to (not including) the RAB budget module and
individual KYC, which are separate sub-phases (2b, 2c).

**Architecture:** New `campaign_drafts` (+ related) tables in `packages/db`, new authenticated
API routes in `apps/api`, and a new `(campaigner)` route group in `apps/web` implementing a
multi-step wizard shell. This is the first phase in the project needing **authenticated
browser-to-API requests** (every prior phase's SSR pages were public reads) — establishing that
pattern correctly is this plan's most safety-critical piece, verified empirically below.

**Tech Stack:** SvelteKit + ElysiaJS + Bun + Drizzle ORM + Postgres + MinIO/S3 (presigned
uploads, verified below) + `@elysiajs/cors` (pinned version, verified below).

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` — Domain Model
(`campaign_drafts`, `campaign_story_answers`, `patients`/`beneficiaries`, `campaign_documents`),
Module Map ("Creation wizard" row), Phase 2 description.

## Global Constraints

- Money is **bigint minor-unit rupiah**, never float (repo-wide constraint since Phase 0a). A
  draft's goal amount lives inside `campaign_drafts.answers` (jsonb) before a real `campaigns`
  row exists — store it there as a **decimal string**, matching `@galangdana/money`'s
  `MoneyJSON` wire convention (`{amount: string, currency}`), never a raw JS number. It is
  parsed to `bigint` only when a later sub-phase (2c) creates the real `campaigns` row.
- **`@elysiajs/cors` MUST be pinned to exactly `1.1.1`, not a caret range.** Verified directly:
  `@elysiajs/cors@1.4.2` (the version a bare `bun add @elysiajs/cors` resolves as of this
  writing) declares `peerDependencies: { elysia: ">= 1.4.0" }`, incompatible with this repo's
  pinned `elysia@1.1.26` — installing it silently pulls a second, mismatched Elysia version
  into `node_modules` alongside the pinned one (confirmed: a script using the unpinned install
  crashed with `Cannot find module '@sinclair/typebox'` from a **different** Elysia's dist path).
  `@elysiajs/cors@1.1.1` declares `peerDependencies: { elysia: ">= 1.1.0" }`, genuinely
  compatible, and was verified end-to-end against a real Elysia 1.1.26 server (see Task 4).
- **Authenticated cross-origin request pattern** (new for this phase, verified empirically —
  see Task 4's brief for the full spike): `apps/api` gains a CORS plugin
  (`origin: process.env.PUBLIC_WEB_URL, credentials: true`); `apps/web`'s Eden Treaty client
  gains `fetch: (input, init) => fetch(input, { ...init, credentials: "include" })` for
  browser-side calls; authenticated SvelteKit pages use `+page.server.ts` (not the `+page.ts`
  pattern every prior phase used for public reads), which alone has access to
  `event.cookies`/`event.request.headers` to forward the session cookie to the cross-origin API
  call. Every new page/load function in this plan that needs the current user follows this.
- **`campaign_documents` uploads go to a NEW, PRIVATE MinIO bucket** (`campaign-documents`), not
  the existing public `campaign-media` bucket. These are evidentiary documents (student ID,
  hospital bills, etc.) tied to an unpublished draft — no anonymous-read policy, unlike
  `campaign-media`. Access requires a presigned GET generated server-side after an ownership
  check (built in a later sub-phase alongside admin moderation review; this plan only builds the
  upload side).
- `campaign_drafts.userId` references `users.id` directly, **not** `campaigners.id`. The
  `campaigners` table (Phase 1) has no auth linkage yet by design — deciding how an authenticated
  user becomes/claims a `campaigners` row is deferred to wherever a draft actually becomes a real
  `campaigns` row (sub-phase 2c), not this plan. A user can have multiple in-progress drafts.
- Every new schema/route file follows the established patterns from Phase 0/1: Drizzle
  `pgEnum`/`pgTable` with `defaultRandom()` uuid PKs, TypeBox contracts with no re-registration of
  the already-globally-registered `"uuid"`/`"email"` formats, Elysia routes returning
  `{ error: "..." }` bodies with an explicit `set.status`, `bun run lint` clean before every
  commit (a recurring gap in earlier phases — do not repeat it).
- This repo is 100% Bun tooling. Never npm/yarn/npx.
- **New Eden Treaty gotcha, verified directly (not in any earlier phase's docs, since no prior
  route prefix used a kebab-case segment): Eden Treaty does NOT camelCase a kebab-case route
  prefix.** `campaignDraftsRoute`'s prefix is `/campaign-drafts` (Task 6) — the correct client
  call is `api["campaign-drafts"]({ id }).get()`, using the literal bracket-notation string key.
  `api.campaignDrafts({ id }).get()` silently resolves to a **different, nonexistent** path and
  404s (confirmed empirically: a spike server with a `/campaign-drafts/:id` route, hit both ways
  — `api["campaign-drafts"]({id}).get()` returned the real data; `api.campaignDrafts({id}).get()`
  returned `error.status === 404`). Every page task in this plan calling this route uses the
  bracket-notation form — do not "clean it up" to dot-notation.

---

## Task 1: `campaign_drafts` + `campaign_story_answers` schema

**Files:**
- Create: `packages/db/src/schema/campaign-drafts.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/campaign-drafts.test.ts`

**Interfaces:**
- Consumes: `users` (Phase 0a), `campaignCategories` (Phase 0a).
- Produces: `campaignDrafts`, `campaignDraftTrackEnum`, `campaignStoryAnswers` tables, consumed by
  every later task in this plan.

- [ ] **Step 1: Write the failing test — `packages/db/src/__tests__/campaign-drafts.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { campaignDrafts, campaignStoryAnswers } from "../schema/campaign-drafts";
import { users } from "../schema/users";
import { eq } from "drizzle-orm";

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
      db.insert(campaignStoryAnswers).values({
        draftId: draft.id,
        questionNumber: 1,
        answerText: "duplicate question number",
      }),
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/campaign-drafts.test.ts`
Expected: FAIL — `Cannot find module '../schema/campaign-drafts'`.

- [ ] **Step 3: Implement the schema — `packages/db/src/schema/campaign-drafts.ts`**

```ts
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { campaignCategories } from "./categories";
import { users } from "./users";

export const campaignDraftTrackEnum = pgEnum("campaign_draft_track", ["medical", "non_medical"]);

// `answers` deliberately stays a loosely-typed jsonb bag for the simple,
// single-field wizard steps (title, a short purpose blurb, a call-to-action
// line, the goal amount) rather than one dedicated column per step -- this
// matches the master plan's own domain model ("campaign_drafts -- track,
// current_step, answers jsonb"). A goal amount inside this jsonb is always
// a DECIMAL STRING (e.g. "15000000"), matching @galangdana/money's
// MoneyJSON wire convention -- never a raw JS number, and never parsed to
// bigint until a real `campaigns` row is created in a later sub-phase.
// Steps with real relational shape (guided story Q&A, patient/beneficiary
// details, documents) get their own tables instead -- see
// campaign-story-answers.ts and this plan's other schema tasks.
export const campaignDrafts = pgTable("campaign_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  track: campaignDraftTrackEnum("track").notNull(),
  categoryId: integer("category_id").references(() => campaignCategories.id),
  currentStep: text("current_step").notNull().default("info"),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignDraft = typeof campaignDrafts.$inferSelect;
export type NewCampaignDraft = typeof campaignDrafts.$inferInsert;

// One row per guided-mode question (6 for medical, 7 for non-medical --
// see this plan's UI tasks for the exact per-track question sets). A
// draft using the "manual" story escape hatch instead has zero rows here
// and stores its freeform text directly in campaignDrafts.answers.story.
export const campaignStoryAnswers = pgTable(
  "campaign_story_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => campaignDrafts.id, { onDelete: "cascade" }),
    questionNumber: integer("question_number").notNull(),
    answerText: text("answer_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.draftId, table.questionNumber)],
);

export type CampaignStoryAnswer = typeof campaignStoryAnswers.$inferSelect;
export type NewCampaignStoryAnswer = typeof campaignStoryAnswers.$inferInsert;
```

- [ ] **Step 4: Add both tables to the schema barrel — modify `packages/db/src/schema/index.ts`**

Add, alongside the existing `export * from "./..."` lines (exact position doesn't matter, this
file has no import-order sensitivity unlike `packages/contracts`'s barrel):

```ts
export * from "./campaign-drafts";
```

- [ ] **Step 5: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate`
Expected: a new `drizzle/000N_<generated_name>.sql` file creating the `campaign_draft_track`
enum, `campaign_drafts` table, and `campaign_story_answers` table with its unique constraint.

Run: `bun run db:migrate`
Expected: `Migrations applied.`

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/campaign-drafts.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 7: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): add campaign_drafts and campaign_story_answers schema"
```

---

## Task 2: `patients` + `beneficiaries` schema

**Files:**
- Create: `packages/db/src/schema/patients.ts`
- Create: `packages/db/src/schema/beneficiaries.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/patients-beneficiaries.test.ts`

**Interfaces:**
- Consumes: `campaignDrafts` (Task 1).
- Produces: `patients` (medical track, `pasien` wizard step), `beneficiaries` (non-medical
  track, `penerima` wizard step) — each 1:1 with a draft via a unique `draftId`.

- [ ] **Step 1: Write the failing test — `packages/db/src/__tests__/patients-beneficiaries.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { beneficiaries } from "../schema/beneficiaries";
import { campaignCategories } from "../schema/categories";
import { campaignDrafts } from "../schema/campaign-drafts";
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
      db.insert(patients).values({ draftId: draft.id, name: "Duplicate", illness: "x" }),
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
      db
        .insert(beneficiaries)
        .values({ draftId: draft.id, name: "Duplicate", needDescription: "x" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/patients-beneficiaries.test.ts`
Expected: FAIL — `Cannot find module '../schema/patients'`.

- [ ] **Step 3: Implement `packages/db/src/schema/patients.ts`**

```ts
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";

// 1:1 with a draft (unique draftId) -- the medical track's `pasien` wizard
// step. Fields are deliberately original, not copied from any observed
// platform's exact labels (only the route name "pasien" was ever
// observed): a real-world patient record for a medical fundraising
// campaign, kept intentionally small for this phase.
export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id")
    .notNull()
    .unique()
    .references(() => campaignDrafts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  age: integer("age"),
  illness: text("illness").notNull(),
  hospitalName: text("hospital_name"),
  relationshipToCampaigner: text("relationship_to_campaigner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
```

- [ ] **Step 4: Implement `packages/db/src/schema/beneficiaries.ts`**

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";

// 1:1 with a draft (unique draftId) -- the non-medical track's `penerima`
// wizard step. Deliberately original fields, not copied from any observed
// platform.
export const beneficiaries = pgTable("beneficiaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id")
    .notNull()
    .unique()
    .references(() => campaignDrafts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship"),
  needDescription: text("need_description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Beneficiary = typeof beneficiaries.$inferSelect;
export type NewBeneficiary = typeof beneficiaries.$inferInsert;
```

- [ ] **Step 5: Add both tables to the schema barrel — modify `packages/db/src/schema/index.ts`**

```ts
export * from "./patients";
export * from "./beneficiaries";
```

- [ ] **Step 6: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate`
Expected: a new migration creating `patients` and `beneficiaries` with their unique `draft_id`
constraints and FKs.

Run: `bun run db:migrate`
Expected: `Migrations applied.`

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/patients-beneficiaries.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 8: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): add patients and beneficiaries schema"
```

---

## Task 3: `campaign_documents` schema + private document bucket

**Files:**
- Create: `packages/db/src/schema/campaign-documents.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `.env.example`
- Test: `packages/db/src/__tests__/campaign-documents.test.ts`

**Interfaces:**
- Consumes: `campaignDrafts` (Task 1).
- Produces: `campaignDocuments` table + `campaignDocumentTypeEnum`, consumed by Task 10's upload
  endpoints.

Evidentiary documents (student ID, hospital bills, etc.) supporting a draft's story — **not**
the individual-KYC identity documents (`ktp`/`selfie`), which are sub-phase 2c's scope and never
appear in this enum. Per this plan's Global Constraint, these upload to a NEW, PRIVATE MinIO
bucket (`campaign-documents`), never the public `campaign-media` bucket Phase 1 built.

- [ ] **Step 1: Write the failing test — `packages/db/src/__tests__/campaign-documents.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { campaignDocuments } from "../schema/campaign-documents";
import { campaignDrafts } from "../schema/campaign-drafts";
import { users } from "../schema/users";

const TEST_USER_ID = "11111111-2222-3333-4444-555555555503";
const TEST_PHONE = "+6281199990003";

beforeAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.insert(users).values({ id: TEST_USER_ID, phone: TEST_PHONE });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, TEST_USER_ID)); // cascades
});

describe("campaignDocuments", () => {
  test("stores multiple documents of different types for the same draft", async () => {
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

    await db.insert(campaignDocuments).values([
      {
        draftId: draft.id,
        type: "riwayat_medis",
        objectKey: `drafts/${draft.id}/riwayat_medis/history.pdf`,
      },
      {
        draftId: draft.id,
        type: "tagihan_rumah_sakit",
        objectKey: `drafts/${draft.id}/tagihan_rumah_sakit/bill.pdf`,
      },
    ]);

    const rows = await db
      .select()
      .from(campaignDocuments)
      .where(eq(campaignDocuments.draftId, draft.id));
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.type).sort()).toEqual(["riwayat_medis", "tagihan_rumah_sakit"]);

    await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/campaign-documents.test.ts`
Expected: FAIL — `Cannot find module '../schema/campaign-documents'`.

- [ ] **Step 3: Implement `packages/db/src/schema/campaign-documents.ts`**

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";

// Evidentiary documents ONLY -- deliberately excludes "ktp"/"selfie" (the
// individual-KYC identity documents), which belong to sub-phase 2c and
// upload through a separate flow with stricter handling. Matches the
// master plan's revision taxonomy minus those two entries.
export const campaignDocumentTypeEnum = pgEnum("campaign_document_type", [
  "kartu_mahasiswa",
  "kartu_pelajar",
  "tagihan_rumah_sakit",
  "tagihan_institusi_pendidikan",
  "media_sosial",
  "sumber_gambar",
  "riwayat_medis",
]);

// objectKey points into the PRIVATE `campaign-documents` MinIO bucket
// (never the public `campaign-media` bucket Phase 1 built for cover
// images) -- see this plan's Global Constraint. No anonymous-read policy
// on that bucket; reading a document back requires a presigned GET
// generated server-side after an ownership check (Task 10).
export const campaignDocuments = pgTable("campaign_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id")
    .notNull()
    .references(() => campaignDrafts.id, { onDelete: "cascade" }),
  type: campaignDocumentTypeEnum("type").notNull(),
  objectKey: text("object_key").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignDocument = typeof campaignDocuments.$inferSelect;
export type NewCampaignDocument = typeof campaignDocuments.$inferInsert;
```

- [ ] **Step 4: Add to the schema barrel — modify `packages/db/src/schema/index.ts`**

```ts
export * from "./campaign-documents";
```

- [ ] **Step 5: Add the private bucket's env var — modify `.env.example`**

Add, alongside the existing `MEDIA_S3_*` block:

```
MEDIA_S3_PRIVATE_BUCKET=campaign-documents
```

- [ ] **Step 6: Create the private bucket locally (one-time, matches this repo's own
  `campaign-media` bucket-creation precedent — `upload-cover-images.ts`'s `ensureBucketExists`
  fails loudly with this exact instruction rather than silently skipping)**

Run:
```bash
docker compose exec minio mc alias set local http://localhost:9000 galangdana galangdana-dev-secret
docker compose exec minio mc mb --ignore-existing local/campaign-documents
```

Expected: `Bucket created successfully` (or already exists). Deliberately **do not** run
`mc anonymous set download` on this bucket — unlike `campaign-media`, it must stay private.
Verify: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9000/campaign-documents/` —
expect `403`, not `200` (confirms no public-read policy leaked onto it).

- [ ] **Step 7: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate`
Expected: a new migration creating the `campaign_document_type` enum and `campaign_documents`
table.

Run: `bun run db:migrate`
Expected: `Migrations applied.`

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/campaign-documents.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 9: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add packages/db .env.example
git commit -m "feat(db): add campaign_documents schema and private document bucket"
```

---

## Task 4: Authenticated cross-origin requests — CORS + shared session-derive

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/lib/session.ts`
- Test: `apps/api/src/lib/session.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`

**Interfaces:**
- Consumes: `validateSession` (Phase 0b, `apps/api/src/auth/session.ts`, unchanged).
- Produces: `sessionDerive` (now exported and shared, not private to `auth.ts`), the API's CORS
  plugin, and a credentialed Eden Treaty client — every later task's authenticated route/page
  depends on this.

This is the single most safety-critical task in this plan: it establishes real authenticated
requests across origins for the first time in this project. Every prior phase's SvelteKit pages
were public reads with no cookie involved at all. Follow this brief exactly — the pattern below
was verified end-to-end against this repo's actual installed `elysia@1.1.26`, not assumed from
docs.

**Why this is needed, and what was verified before this brief was written:**

`apps/web` (`http://localhost:5173`) and `apps/api` (`http://localhost:3001`) are different
origins. A browser will not send the `session` cookie set by `/auth/otp/verify` etc. on a
cross-origin request unless (a) the API responds with CORS headers explicitly allowing the
web origin **and** `credentials: true`, and (b) the client's `fetch` call is made with
`credentials: "include"`. Neither exists in this codebase yet — Phase 0b's auth routes were only
ever exercised via `apps/api`'s own test suite calling `app.handle()` directly, never through a
real cross-origin browser request.

A **verified, working spike** (a standalone Elysia server, `@elysiajs/cors@1.1.1`, config
`{ origin: "http://localhost:5173", credentials: true }`) confirmed: a preflight `OPTIONS`
request gets `Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Origin:
http://localhost:5173` (echoed, not `*` — required for credentialed requests per the CORS spec);
a cookie set by one cross-origin request is correctly sent back on a later cross-origin request
from the same client when that client sends the cookie and `Origin` header (as a real browser
with `credentials: "include"` does).

**The peer-dependency trap, verified directly:** a bare `bun add @elysiajs/cors` resolves
`1.4.2`, which declares `peerDependencies: { elysia: ">= 1.4.0" }` — incompatible with this
repo's pinned `elysia@1.1.26`. Installing it silently pulled a second, mismatched Elysia into
`node_modules`, and a server using it crashed with `Cannot find module '@sinclair/typebox'` from
that other Elysia's dist path (a confusing, misleading error with no obvious connection to the
real cause). `@elysiajs/cors@1.1.1` declares `peerDependencies: { elysia: ">= 1.1.0" }` — this
one is genuinely compatible, and is the version this task must install.

- [ ] **Step 1: Install the correct, exact CORS plugin version**

```bash
cd apps/api && bun add @elysiajs/cors@1.1.1
```

Expected: `apps/api/package.json` gains `"@elysiajs/cors": "1.1.1"` (or `"^1.1.1"` — either is
fine as long as `bun.lock` resolves to exactly `1.1.1`, confirm via `bun.lock`). **Verify no
second Elysia version was pulled in**: `grep -c '"elysia@' bun.lock` before and after this
install must be unchanged (still exactly the one pinned `elysia@1.1.26` entry).

- [ ] **Step 2: Extract `sessionDerive` into a shared, exported module — create `apps/api/src/lib/session.ts`**

This is a straight extraction of the plugin already defined privately inside `auth.ts` (Phase
0b) — no behavior change, just making it importable by other route files.

```ts
import { validateSession } from "../auth/session";
import { Elysia } from "elysia";

export const SESSION_COOKIE = "session";

/**
 * Derives the current user from the session cookie on every request this
 * plugin is applied to. Downstream handlers read `user`/`sessionToken`
 * from context; both are `null` when there is no valid session, so a
 * protected route checks `if (!user) { set.status = 401; ... }` rather
 * than this plugin throwing. Shared across every route file that needs
 * auth (originally private to auth.ts; extracted here in Phase 2a when
 * campaign-drafts routes became the second consumer).
 */
export const sessionDerive = new Elysia().derive({ as: "scoped" }, async ({ cookie }) => {
  const token = cookie[SESSION_COOKIE]?.value;
  if (!token) return { user: null, sessionToken: null };
  const result = await validateSession(token);
  if (!result) return { user: null, sessionToken: null };
  return { user: result.user, sessionToken: token };
});
```

- [ ] **Step 3: Write the failing test — `apps/api/src/lib/session.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { db, sessions, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { sessionDerive } from "./session";

const TEST_USER_ID = "22222222-3333-4444-5555-666666666601";
const TEST_PHONE = "+6281199990101";
const TEST_TOKEN = "session-derive-test-token";

describe("sessionDerive", () => {
  test("derives a null user when no session cookie is present", async () => {
    const app = new Elysia().use(sessionDerive).get("/whoami", ({ user }) => ({ user }));
    const resp = await app.handle(new Request("http://localhost/whoami"));
    const body = (await resp.json()) as { user: unknown };
    expect(body.user).toBeNull();
  });

  test("derives the real user when a valid session cookie is present", async () => {
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
    await db.insert(users).values({ id: TEST_USER_ID, phone: TEST_PHONE });
    await db.insert(sessions).values({
      id: TEST_TOKEN,
      userId: TEST_USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    });

    const app = new Elysia().use(sessionDerive).get("/whoami", ({ user }) => ({ user }));
    const resp = await app.handle(
      new Request("http://localhost/whoami", {
        headers: { cookie: `session=${TEST_TOKEN}` },
      }),
    );
    const body = (await resp.json()) as { user: { id: string } | null };
    expect(body.user?.id).toBe(TEST_USER_ID);

    await db.delete(sessions).where(eq(sessions.id, TEST_TOKEN));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/session.test.ts`
Expected: PASS — 2 tests. (This is a pure extraction, so this should pass immediately once
`session.ts` exists — there is no "red" step here since the logic is unchanged, only its
location.)

- [ ] **Step 5: Update `auth.ts` to use the shared module — modify `apps/api/src/routes/auth.ts`**

Remove the private `sessionDerive` definition (the `const sessionDerive = new Elysia().derive(...)`
block) and its now-unused direct `validateSession` import if nothing else in the file uses it
directly (check: `revokeSession`/`createSession` are still used elsewhere in the file and must
stay imported). Add:

```ts
import { sessionDerive } from "../lib/session";
```

Everything else in `auth.ts` (the `SESSION_COOKIE` constant, cookie helpers, all routes) stays
exactly as-is — `authRoute` still does `.use(sessionDerive)`, just importing it from the new
location instead of defining it locally.

- [ ] **Step 6: Add CORS to the API — modify `apps/api/src/index.ts`**

```ts
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { withApiResponseMapping } from "./response-mapper";
import { authRoute } from "./routes/auth";
import { campaignsRoute } from "./routes/campaigns";
import { healthRoute } from "./routes/health";
import { searchRoute } from "./routes/search";

// Every response body is run through the BigInt-safe serializer, so no
// route added later can accidentally hand a raw bigint to JSON.stringify
// and crash the response. Also preserves set.status, thrown-error status
// codes, and real Response objects returned directly from handlers -- see
// response-mapper.ts (shared with response-mapper.test.ts, so the two can
// never silently drift apart).
export const app = withApiResponseMapping(new Elysia())
  // credentials: true + a specific origin (not `*`) is required for the
  // browser to actually attach the session cookie to a cross-origin
  // request -- verified directly against this repo's real elysia@1.1.26 +
  // @elysiajs/cors@1.1.1 (see this task's brief for the full spike).
  .use(
    cors({
      origin: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173",
      credentials: true,
    }),
  )
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

- [ ] **Step 7: Configure the Eden Treaty client for credentialed requests — modify `apps/web/src/lib/api-client.ts`**

```ts
import { env } from "$env/dynamic/public";
import { treaty } from "@elysiajs/eden";
import type { App } from "@galangdana/api";

const API_URL = env.PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Typed against the live Elysia `App` type from apps/api — renaming or
 * removing a route there is a compile error here, not a silent 404 at
 * runtime.
 *
 * Uses $env/dynamic/public, not raw process.env: this module is imported
 * by a universal +page.ts load, which runs both server-side (SSR) and
 * client-side (hydration, then every later client-side navigation).
 * Vite's client build silently substitutes process.env with an empty
 * object rather than throwing, so a raw process.env.PUBLIC_API_URL read
 * doesn't crash the browser bundle -- it just always evaluates to
 * undefined there, falling back to localhost regardless of what the
 * server's real PUBLIC_API_URL is. $env/dynamic/public carries the
 * actual value through to the client correctly.
 *
 * `credentials: "include"` is required for the browser to attach the
 * session cookie on requests this client makes directly (client-side
 * wizard-step saves, document uploads) -- apps/api's own origin-specific
 * CORS config (see Task 4) is the other half of this; a bare
 * `credentials: "include"` with a `*` CORS origin would be silently
 * ignored by the browser, so both sides matter. This does NOT solve
 * server-side (SSR) cookie forwarding on its own -- see this plan's
 * later page tasks for the `+page.server.ts` pattern that handles that
 * half separately, since a server-side fetch has no browser-managed
 * cookie jar to opt into.
 */
export const api = treaty<App>(API_URL, {
  fetch: { credentials: "include" },
});
```

- [ ] **Step 8: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean. (`bun run typecheck` covers `apps/web` too, confirming `api-client.ts`'s
`treaty()` call with the new `fetch` option still typechecks against the installed
`@elysiajs/eden` version — if it doesn't, read the actual installed Eden Treaty types rather
than guessing at the option's shape, and report what you find.)

- [ ] **Step 9: Manually verify the real cross-origin cookie flow, end to end**

With `apps/api` and `apps/web` both running locally (check `docker compose ps` first; use
`API_PORT=3011` + `PUBLIC_API_URL=http://localhost:3011` if port 3001 is occupied, matching
earlier phases' documented port-collision workaround), from a terminal (not a browser — none is
available in this environment):

```bash
# Request an OTP, then verify it (Phase 0b's dev-mode OTP is logged to the console — check
# apps/api's own stdout, or read apps/api/src/auth/otp.ts if the exact dev-bypass behavior
# needs re-confirming), capturing the Set-Cookie header:
curl -s -i -X POST http://localhost:3011/auth/otp/request \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5173" \
  -d '{"phone": "+6281200000099"}'
# ... then, using the code from apps/api's stdout:
curl -s -i -X POST http://localhost:3011/auth/otp/verify \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5173" \
  -d '{"phone": "+6281200000099", "code": "<code from stdout>"}' -c /tmp/cookies.txt
# Confirm the response has Access-Control-Allow-Origin: http://localhost:5173 and
# Access-Control-Allow-Credentials: true, and that a `session=...` cookie was set.

# Then confirm the cookie authenticates a follow-up cross-origin request:
curl -s -b /tmp/cookies.txt http://localhost:3011/auth/me -H "Origin: http://localhost:5173"
# Expect: {"user": {...}} with the phone number just registered, not a 401.
```

Report the actual captured output. Clean up `/tmp/cookies.txt` and stop both dev servers
afterward.

- [ ] **Step 10: Commit**

```bash
git add apps/api apps/web
git commit -m "feat(api,web): add CORS + shared session-derive for authenticated cross-origin requests"
```

---

## Task 5: Campaign draft contracts

**Files:**
- Create: `packages/contracts/src/campaign-drafts.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: nothing beyond `@sinclair/typebox` — a pure, fully-specified schema declaration
  task, no external state.
- Produces: schemas consumed by every route task in this plan (Tasks 6–10) and every page task
  (Tasks 12–20).

- [ ] **Step 1: Implement `packages/contracts/src/campaign-drafts.ts`**

Do NOT re-register `format: "uuid"` — already globally registered by `auth.ts`, imported before
this file at barrel-load time (this repo's established FormatRegistry gotcha).

```ts
import { type Static, Type } from "@sinclair/typebox";

export const CampaignDraftTrackSchema = Type.Union([
  Type.Literal("medical"),
  Type.Literal("non_medical"),
]);

export const CreateCampaignDraftBodySchema = Type.Object({
  track: CampaignDraftTrackSchema,
  categoryId: Type.Optional(Type.Number()),
});

export const CampaignDraftSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  track: CampaignDraftTrackSchema,
  categoryId: Type.Union([Type.Number(), Type.Null()]),
  currentStep: Type.String(),
  answers: Type.Record(Type.String(), Type.Unknown()),
  expiresAt: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type CampaignDraftResponse = Static<typeof CampaignDraftSchema>;

export const CampaignDraftErrorSchema = Type.Object({ error: Type.String() });

export const SaveDraftAnswersBodySchema = Type.Object({
  step: Type.String(),
  answers: Type.Record(Type.String(), Type.Unknown()),
});

export const StoryQuestionAnswerSchema = Type.Object({
  questionNumber: Type.Number({ minimum: 1 }),
  answerText: Type.String({ minLength: 1 }),
});

export const SaveGuidedStoryBodySchema = Type.Object({
  mode: Type.Literal("guided"),
  answers: Type.Array(StoryQuestionAnswerSchema, { minItems: 1 }),
});

export const SaveManualStoryBodySchema = Type.Object({
  mode: Type.Literal("manual"),
  text: Type.String({ minLength: 1 }),
});

export const SavePatientBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  age: Type.Optional(Type.Number({ minimum: 0 })),
  illness: Type.String({ minLength: 1 }),
  hospitalName: Type.Optional(Type.String()),
  relationshipToCampaigner: Type.Optional(Type.String()),
});

export const SaveBeneficiaryBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  relationship: Type.Optional(Type.String()),
  needDescription: Type.String({ minLength: 1 }),
});

export const CampaignDocumentTypeSchema = Type.Union([
  Type.Literal("kartu_mahasiswa"),
  Type.Literal("kartu_pelajar"),
  Type.Literal("tagihan_rumah_sakit"),
  Type.Literal("tagihan_institusi_pendidikan"),
  Type.Literal("media_sosial"),
  Type.Literal("sumber_gambar"),
  Type.Literal("riwayat_medis"),
]);

export const PresignDocumentUploadBodySchema = Type.Object({
  type: CampaignDocumentTypeSchema,
  fileName: Type.String({ minLength: 1 }),
});

export const PresignDocumentUploadResponseSchema = Type.Object({
  uploadUrl: Type.String(),
  objectKey: Type.String(),
  expiresInSeconds: Type.Number(),
});

export const ConfirmDocumentUploadBodySchema = Type.Object({
  type: CampaignDocumentTypeSchema,
  objectKey: Type.String({ minLength: 1 }),
});

export const CampaignDocumentSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: CampaignDocumentTypeSchema,
  objectKey: Type.String(),
  uploadedAt: Type.String(),
});
export type CampaignDocumentResponse = Static<typeof CampaignDocumentSchema>;

// The full draft-detail response (GET /campaign-drafts/:id and the
// `rangkuman` summary step) aggregates the draft plus every related
// table this plan builds -- present whichever of patient/beneficiary
// applies to the draft's track, null for the other.
export const CampaignDraftDetailSchema = Type.Composite([
  CampaignDraftSchema,
  Type.Object({
    storyAnswers: Type.Array(StoryQuestionAnswerSchema),
    manualStory: Type.Union([Type.String(), Type.Null()]),
    patient: Type.Union([
      Type.Object({
        name: Type.String(),
        age: Type.Union([Type.Number(), Type.Null()]),
        illness: Type.String(),
        hospitalName: Type.Union([Type.String(), Type.Null()]),
        relationshipToCampaigner: Type.Union([Type.String(), Type.Null()]),
      }),
      Type.Null(),
    ]),
    beneficiary: Type.Union([
      Type.Object({
        name: Type.String(),
        relationship: Type.Union([Type.String(), Type.Null()]),
        needDescription: Type.String(),
      }),
      Type.Null(),
    ]),
    documents: Type.Array(CampaignDocumentSchema),
  }),
]);
export type CampaignDraftDetailResponse = Static<typeof CampaignDraftDetailSchema>;
```

- [ ] **Step 2: Add every schema and type to the barrel — modify `packages/contracts/src/index.ts`**

Append, after the existing campaigns exports:

```ts
export {
  CampaignDocumentSchema,
  CampaignDocumentTypeSchema,
  CampaignDraftDetailSchema,
  CampaignDraftErrorSchema,
  CampaignDraftSchema,
  CampaignDraftTrackSchema,
  ConfirmDocumentUploadBodySchema,
  CreateCampaignDraftBodySchema,
  PresignDocumentUploadBodySchema,
  PresignDocumentUploadResponseSchema,
  SaveBeneficiaryBodySchema,
  SaveDraftAnswersBodySchema,
  SaveGuidedStoryBodySchema,
  SaveManualStoryBodySchema,
  SavePatientBodySchema,
  StoryQuestionAnswerSchema,
} from "./campaign-drafts";
export type { CampaignDocumentResponse, CampaignDraftDetailResponse, CampaignDraftResponse } from "./campaign-drafts";
```

- [ ] **Step 3: Run typecheck and lint**

Run: `cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: both clean. (No dedicated test file for this task — pure schema declarations with no
runtime logic; Task 6 onward exercises these schemas through real routes, which is where a schema
mistake would actually surface, matching this repo's established practice for contracts-only
tasks — see Phase 1's Task 5.)

- [ ] **Step 4: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add campaign draft/story/patient/beneficiary/document schemas"
```

---

## Task 6: `POST /campaign-drafts` + `GET /campaign-drafts/:id`

**Files:**
- Create: `apps/api/src/routes/campaign-drafts.ts`
- Create: `apps/api/src/routes/campaign-drafts.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `sessionDerive` (Task 4), `campaignDrafts`/`patients`/`beneficiaries`/
  `campaignDocuments`/`campaignStoryAnswers` (Tasks 1–3), contracts (Task 5).
- Produces: `campaignDraftsRoute`, the two endpoints every later route/page task builds on.
  `expiresAt` is set to **7 days from creation** — a draft not touched in a week is abandoned;
  no cleanup job exists yet (out of scope for this plan), the column just records the intent.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/campaign-drafts.test.ts`**

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { db, campaignCategories, sessions, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { app } from "../index";

const TEST_USER_ID = "33333333-4444-5555-6666-777777777701";
const OTHER_USER_ID = "33333333-4444-5555-6666-777777777702";
const TEST_TOKEN = "campaign-drafts-test-token";
const OTHER_TOKEN = "campaign-drafts-other-token";
let categoryId: number;

beforeAll(async () => {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found — run db:seed first");
  categoryId = category.id;

  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.delete(users).where(eq(users.id, OTHER_USER_ID));
  await db.insert(users).values([
    { id: TEST_USER_ID, phone: "+6281199990201" },
    { id: OTHER_USER_ID, phone: "+6281199990202" },
  ]);
  await db.insert(sessions).values([
    { id: TEST_TOKEN, userId: TEST_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: OTHER_TOKEN, userId: OTHER_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  ]);
});

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { ...init.headers, cookie: `session=${token}` },
  });
}

describe("POST /campaign-drafts", () => {
  test("requires authentication", async () => {
    const resp = await app.handle(
      new Request("http://localhost/campaign-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical" }),
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("creates a draft owned by the authenticated user, defaulting currentStep to 'info'", async () => {
    const resp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; track: string; currentStep: string };
    expect(body.track).toBe("medical");
    expect(body.currentStep).toBe("info");
    expect(body.id).toBeTruthy();
  });
});

describe("GET /campaign-drafts/:id", () => {
  test("returns the full draft detail for its owner", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "non_medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      id: string;
      storyAnswers: unknown[];
      documents: unknown[];
      patient: unknown;
      beneficiary: unknown;
    };
    expect(body.id).toBe(created.id);
    expect(body.storyAnswers).toEqual([]);
    expect(body.documents).toEqual([]);
    expect(body.patient).toBeNull();
    expect(body.beneficiary).toBeNull();
  });

  test("404s for a draft that does not exist", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/campaign-drafts/00000000-0000-0000-0000-000000000000",
        TEST_TOKEN,
      ),
    );
    expect(resp.status).toBe(404);
  });

  test("404s (not 403) when a different user requests someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, OTHER_TOKEN),
    );
    // 404, not 403: this endpoint must not confirm to an unauthorized
    // caller that a draft with this ID even exists.
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: FAIL — the route doesn't exist yet (404/`NOT_FOUND` on every request).

- [ ] **Step 3: Implement `apps/api/src/routes/campaign-drafts.ts`**

```ts
import {
  CampaignDraftDetailSchema,
  CampaignDraftErrorSchema,
  CampaignDraftSchema,
  CreateCampaignDraftBodySchema,
} from "@galangdana/contracts";
import {
  beneficiaries,
  campaignDocuments,
  campaignDrafts,
  campaignStoryAnswers,
  db,
  patients,
} from "@galangdana/db";
import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const campaignDraftsRoute = new Elysia({ prefix: "/campaign-drafts" })
  .use(sessionDerive)
  .post(
    "/",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .insert(campaignDrafts)
        .values({
          userId: user.id,
          track: body.track,
          categoryId: body.categoryId,
          expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
        })
        .returning();
      if (!draft) {
        set.status = 500;
        return { error: "draft_creation_failed" };
      }
      return {
        ...draft,
        expiresAt: draft.expiresAt.toISOString(),
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
      };
    },
    {
      body: CreateCampaignDraftBodySchema,
      response: { 200: CampaignDraftSchema, 401: CampaignDraftErrorSchema, 500: CampaignDraftErrorSchema },
    },
  )
  .get(
    "/:id",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select()
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const [storyAnswers, documents, [patient], [beneficiary]] = await Promise.all([
        db
          .select({ questionNumber: campaignStoryAnswers.questionNumber, answerText: campaignStoryAnswers.answerText })
          .from(campaignStoryAnswers)
          .where(eq(campaignStoryAnswers.draftId, draft.id)),
        db
          .select()
          .from(campaignDocuments)
          .where(eq(campaignDocuments.draftId, draft.id)),
        db.select().from(patients).where(eq(patients.draftId, draft.id)),
        db.select().from(beneficiaries).where(eq(beneficiaries.draftId, draft.id)),
      ]);

      return {
        ...draft,
        expiresAt: draft.expiresAt.toISOString(),
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
        storyAnswers,
        manualStory: typeof draft.answers.story === "string" ? draft.answers.story : null,
        patient: patient
          ? {
              name: patient.name,
              age: patient.age,
              illness: patient.illness,
              hospitalName: patient.hospitalName,
              relationshipToCampaigner: patient.relationshipToCampaigner,
            }
          : null,
        beneficiary: beneficiary
          ? {
              name: beneficiary.name,
              relationship: beneficiary.relationship,
              needDescription: beneficiary.needDescription,
            }
          : null,
        documents: documents.map((d) => ({
          id: d.id,
          type: d.type,
          objectKey: d.objectKey,
          uploadedAt: d.uploadedAt.toISOString(),
        })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: CampaignDraftDetailSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  );
```

- [ ] **Step 4: Wire the route — modify `apps/api/src/index.ts`**

Add the import and `.use(campaignDraftsRoute)` alongside the existing route uses (any position
relative to the other `.use()` calls is fine — Elysia routes are prefix-scoped, not
order-sensitive here).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /campaign-drafts and GET /campaign-drafts/:id"
```

---

## Task 7: `PATCH /campaign-drafts/:id/answers` (generic step save)

**Files:**
- Modify: `apps/api/src/routes/campaign-drafts.ts`
- Modify: `apps/api/src/routes/campaign-drafts.test.ts`

**Interfaces:**
- Consumes: everything from Task 6 (extends the same route chain, same file).
- Produces: the endpoint every "simple field" wizard step (Task 14's batch: `tujuan`, `judul`,
  `target-donasi`, `ajakan`, `data-diri`) saves through.

- [ ] **Step 1: Add the failing tests — append to `apps/api/src/routes/campaign-drafts.test.ts`**

Add a new `describe` block after the existing ones:

```ts
describe("PATCH /campaign-drafts/:id/answers", () => {
  test("merges new answers into the existing jsonb and advances currentStep", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const first = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/answers`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "tujuan", answers: { purpose: "Biaya operasi jantung" } }),
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { currentStep: string; answers: Record<string, unknown> };
    expect(firstBody.currentStep).toBe("tujuan");
    expect(firstBody.answers).toEqual({ purpose: "Biaya operasi jantung" });

    // A second save on a different step merges rather than replaces.
    const second = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/answers`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "judul", answers: { title: "Bantu Aldi Sembuh" } }),
      }),
    );
    const secondBody = (await second.json()) as { currentStep: string; answers: Record<string, unknown> };
    expect(secondBody.currentStep).toBe("judul");
    expect(secondBody.answers).toEqual({
      purpose: "Biaya operasi jantung",
      title: "Bantu Aldi Sembuh",
    });
  });

  test("404s (not 403) when saving to someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/answers`, OTHER_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "tujuan", answers: { purpose: "hijack attempt" } }),
      }),
    );
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: the 2 new tests FAIL, the earlier 5 still PASS.

- [ ] **Step 3: Add the endpoint — modify `apps/api/src/routes/campaign-drafts.ts`**

Add the new import to the existing `@galangdana/contracts` import line, then chain a new
`.patch(...)` onto the same `campaignDraftsRoute` instance (after the existing `.get("/:id", ...)`,
same fluent chain — do not create a second `new Elysia()`):

```ts
import {
  CampaignDraftDetailSchema,
  CampaignDraftErrorSchema,
  CampaignDraftSchema,
  CreateCampaignDraftBodySchema,
  SaveDraftAnswersBodySchema,
} from "@galangdana/contracts";
```

```ts
  .patch(
    "/:id/answers",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [existing] = await db
        .select({ answers: campaignDrafts.answers })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!existing) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const [updated] = await db
        .update(campaignDrafts)
        .set({
          answers: { ...existing.answers, ...body.answers },
          currentStep: body.step,
          updatedAt: new Date(),
        })
        .where(eq(campaignDrafts.id, params.id))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "draft_update_failed" };
      }

      return {
        ...updated,
        expiresAt: updated.expiresAt.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveDraftAnswersBodySchema,
      response: { 200: CampaignDraftSchema, 401: CampaignDraftErrorSchema, 404: CampaignDraftErrorSchema, 500: CampaignDraftErrorSchema },
    },
  );
```

(The trailing semicolon moves to the end of this new `.patch(...)` call, since it's now the last
link in the chain — the preceding `.get("/:id", ...)` call's own closing no longer ends with
`;`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: PASS — 7 tests total.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add PATCH /campaign-drafts/:id/answers"
```

---

## Task 8: `PUT /campaign-drafts/:id/story` (guided or manual)

**Files:**
- Modify: `apps/api/src/routes/campaign-drafts.ts`
- Modify: `apps/api/src/routes/campaign-drafts.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–7 (same route chain).
- Produces: the endpoint the `cerita` wizard step (Task 15) saves through.

The two modes are mutually exclusive per draft: saving `guided` mode replaces the full
`campaignStoryAnswers` set for this draft (delete-then-insert, not per-question upsert — the
guided UI always submits its complete answer set at once) and clears any leftover
`answers.story` manual text; saving `manual` mode deletes any existing guided answer rows and
sets `answers.story`. This keeps a draft from ending up with both a guided answer set AND a
manual story simultaneously, which the `rangkuman` summary step (Task 20) would otherwise have
to arbitrate.

- [ ] **Step 1: Add the failing tests — append to `apps/api/src/routes/campaign-drafts.test.ts`**

```ts
describe("PUT /campaign-drafts/:id/story", () => {
  test("guided mode replaces the full story-answer set", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const first = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "guided",
          answers: [
            { questionNumber: 1, answerText: "Jawaban pertama" },
            { questionNumber: 2, answerText: "Jawaban kedua" },
          ],
        }),
      }),
    );
    expect(first.status).toBe(200);

    const detailFirst = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailFirstBody = (await detailFirst.json()) as { storyAnswers: unknown[] };
    expect(detailFirstBody.storyAnswers.length).toBe(2);

    // Re-saving guided mode with fewer answers REPLACES the set, not merges.
    const second = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "guided",
          answers: [{ questionNumber: 1, answerText: "Jawaban revisi" }],
        }),
      }),
    );
    expect(second.status).toBe(200);

    const detailSecond = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailSecondBody = (await detailSecond.json()) as {
      storyAnswers: Array<{ questionNumber: number; answerText: string }>;
    };
    expect(detailSecondBody.storyAnswers.length).toBe(1);
    expect(detailSecondBody.storyAnswers[0]?.answerText).toBe("Jawaban revisi");
  });

  test("manual mode sets answers.story and clears any existing guided answers", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "non_medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "guided",
          answers: [{ questionNumber: 1, answerText: "will be cleared" }],
        }),
      }),
    );

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "manual", text: "Cerita lengkap yang ditulis manual." }),
      }),
    );
    expect(resp.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailBody = (await detail.json()) as {
      storyAnswers: unknown[];
      manualStory: string | null;
    };
    expect(detailBody.storyAnswers).toEqual([]);
    expect(detailBody.manualStory).toBe("Cerita lengkap yang ditulis manual.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: the 2 new tests FAIL, the earlier 7 still PASS.

- [ ] **Step 3: Add the endpoint — modify `apps/api/src/routes/campaign-drafts.ts`**

Add to the contracts import line: `SaveGuidedStoryBodySchema`, `SaveManualStoryBodySchema`. Add
`campaignStoryAnswers` is already imported from Task 6. Add `Type` from `@sinclair/typebox` (or
use `t.Union`/Elysia's own re-exported `t` — this repo's established convention per
`apps/api/src/routes/auth.ts` is Elysia's own `t`, not a separate typebox import, so use
`t.Union([SaveGuidedStoryBodySchema, SaveManualStoryBodySchema])` inline in the route options,
no new import needed beyond the two schemas themselves).

Chain a new `.put(...)` after the `.patch(...)` from Task 7 (same fluent chain):

```ts
  .put(
    "/:id/story",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [existing] = await db
        .select({ id: campaignDrafts.id, answers: campaignDrafts.answers })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!existing) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      // Both modes clear the other's data first, so a draft never ends up
      // with both a guided answer set and a manual story simultaneously.
      await db.delete(campaignStoryAnswers).where(eq(campaignStoryAnswers.draftId, params.id));

      if (body.mode === "guided") {
        await db.insert(campaignStoryAnswers).values(
          body.answers.map((a) => ({
            draftId: params.id,
            questionNumber: a.questionNumber,
            answerText: a.answerText,
          })),
        );
        const { story: _removed, ...restAnswers } = existing.answers;
        await db
          .update(campaignDrafts)
          .set({ answers: restAnswers, updatedAt: new Date() })
          .where(eq(campaignDrafts.id, params.id));
      } else {
        await db
          .update(campaignDrafts)
          .set({ answers: { ...existing.answers, story: body.text }, updatedAt: new Date() })
          .where(eq(campaignDrafts.id, params.id));
      }

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Union([SaveGuidedStoryBodySchema, SaveManualStoryBodySchema]),
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: PASS — 9 tests total.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add PUT /campaign-drafts/:id/story (guided or manual)"
```

---

## Task 9: `PUT /campaign-drafts/:id/patient` + `PUT /campaign-drafts/:id/beneficiary`

**Files:**
- Modify: `apps/api/src/routes/campaign-drafts.ts`
- Modify: `apps/api/src/routes/campaign-drafts.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–8 (same route chain).
- Produces: the endpoints the `pasien` (Task 16) and `penerima` (Task 17) wizard steps save
  through. Both use Postgres `ON CONFLICT` upsert on the table's unique `draftId` — re-saving the
  step overwrites the prior save rather than erroring or duplicating.

- [ ] **Step 1: Add the failing tests — append to `apps/api/src/routes/campaign-drafts.test.ts`**

```ts
describe("PUT /campaign-drafts/:id/patient", () => {
  test("upserts patient details, re-saving overwrites rather than duplicating", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const first = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/patient`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Aldi", age: 2, illness: "Kelainan jantung" }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/patient`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Aldi Revisi", age: 3, illness: "Kelainan jantung bawaan" }),
      }),
    );
    expect(second.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const body = (await detail.json()) as { patient: { name: string; age: number } | null };
    expect(body.patient?.name).toBe("Aldi Revisi");
    expect(body.patient?.age).toBe(3);
  });
});

describe("PUT /campaign-drafts/:id/beneficiary", () => {
  test("upserts beneficiary details", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "non_medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/beneficiary`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Warga Desa Sukamaju",
          needDescription: "Renovasi musala.",
        }),
      }),
    );
    expect(resp.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const body = (await detail.json()) as { beneficiary: { name: string } | null };
    expect(body.beneficiary?.name).toBe("Warga Desa Sukamaju");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: the 2 new tests FAIL, the earlier 9 still PASS.

- [ ] **Step 3: Add both endpoints — modify `apps/api/src/routes/campaign-drafts.ts`**

Add `SaveBeneficiaryBodySchema`, `SavePatientBodySchema` to the contracts import line. Add
`patients`/`beneficiaries` — already imported from Task 6 (used there for the detail-fetch
query). Chain both after the `.put("/:id/story", ...)` from Task 8:

```ts
  .put(
    "/:id/patient",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      await db
        .insert(patients)
        .values({ draftId: params.id, ...body })
        .onConflictDoUpdate({ target: patients.draftId, set: body });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SavePatientBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  )
  .put(
    "/:id/beneficiary",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      await db
        .insert(beneficiaries)
        .values({ draftId: params.id, ...body })
        .onConflictDoUpdate({ target: beneficiaries.draftId, set: body });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveBeneficiaryBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
      },
    },
  );
```

(Remember: the trailing semicolon moves to the end of the LAST call in the chain — after
`.put("/:id/beneficiary", ...)` now, not after `.put("/:id/story", ...)`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: PASS — 11 tests total.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add PUT /campaign-drafts/:id/patient and /beneficiary"
```

---

## Task 10: Document upload — presign + confirm

**Files:**
- Modify: `apps/api/src/routes/campaign-drafts.ts`
- Modify: `apps/api/src/routes/campaign-drafts.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–9 (same route chain), `campaignDocuments` (Task 3).
- Produces: the endpoints the `riwayat-medis` (evidentiary document) step (Task 18) uses. The
  client requests a presigned PUT URL, uploads bytes directly to MinIO (never routing file bytes
  through the Bun API process), then confirms — matching this plan's Global Constraint (a
  PRIVATE bucket, verified via `Bun.S3Client.file(...).presign({ method: "PUT" })` against real
  MinIO before this brief was written; see this task's own verification step for the same
  round-trip check).

**Security-relevant design, read before implementing:** the objectKey a presigned URL targets is
always **server-generated** (`drafts/{draftId}/{type}/{randomId}.{ext}`), never client-supplied —
a client only supplies `type` and `fileName` (used solely to extract a whitelisted extension).
The `/confirm` step re-derives and checks that the client-supplied `objectKey` genuinely starts
with `drafts/{draftId}/` before inserting a `campaignDocuments` row — this stops a malicious
client from confirming an arbitrary object path (e.g. one belonging to a different draft, or one
outside the `drafts/` prefix entirely) into the database as if it were their own upload.

- [ ] **Step 1: Add the failing tests — append to `apps/api/src/routes/campaign-drafts.test.ts`**

```ts
describe("POST /campaign-drafts/:id/documents/presign", () => {
  test("returns a presigned PUT URL scoped under drafts/{draftId}/{type}/", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(
        `http://localhost/campaign-drafts/${created.id}/documents/presign`,
        TEST_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "riwayat_medis", fileName: "riwayat.pdf" }),
        },
      ),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { uploadUrl: string; objectKey: string };
    expect(body.objectKey.startsWith(`drafts/${created.id}/riwayat_medis/`)).toBe(true);
    expect(body.objectKey.endsWith(".pdf")).toBe(true);
    expect(body.uploadUrl).toContain(body.objectKey);
  });

  test("rejects a disallowed file extension", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(
        `http://localhost/campaign-drafts/${created.id}/documents/presign`,
        TEST_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "riwayat_medis", fileName: "malware.exe" }),
        },
      ),
    );
    expect(resp.status).toBe(422);
  });
});

describe("POST /campaign-drafts/:id/documents (confirm)", () => {
  test("records the document after a real presigned upload round-trip", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const presignResp = await app.handle(
      authedRequest(
        `http://localhost/campaign-drafts/${created.id}/documents/presign`,
        TEST_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "riwayat_medis", fileName: "riwayat.pdf" }),
        },
      ),
    );
    const { uploadUrl, objectKey } = (await presignResp.json()) as {
      uploadUrl: string;
      objectKey: string;
    };

    // A real PUT against the real presigned URL, against real local MinIO
    // -- not a mock -- matching this codebase's established no-mocking
    // testing philosophy for real infrastructure.
    const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake pdf bytes" });
    expect(putResp.status).toBe(200);

    const confirmResp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/documents`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "riwayat_medis", objectKey }),
      }),
    );
    expect(confirmResp.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailBody = (await detail.json()) as {
      documents: Array<{ type: string; objectKey: string }>;
    };
    expect(detailBody.documents.length).toBe(1);
    expect(detailBody.documents[0]?.objectKey).toBe(objectKey);
  });

  test("rejects confirming an objectKey outside this draft's own prefix", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/documents`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "riwayat_medis",
          objectKey: "drafts/00000000-0000-0000-0000-000000000000/riwayat_medis/hijack.pdf",
        }),
      }),
    );
    expect(resp.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: the 4 new tests FAIL, the earlier 11 still PASS.

- [ ] **Step 3: Add both endpoints — modify `apps/api/src/routes/campaign-drafts.ts`**

Add `CampaignDocumentSchema`, `ConfirmDocumentUploadBodySchema`, `PresignDocumentUploadBodySchema`,
`PresignDocumentUploadResponseSchema` to the contracts import line. Add `campaignDocuments` —
already imported from Task 6. Add near the top of the file, alongside the existing `DRAFT_TTL_MS`
constant:

```ts
const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

const documentsS3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "galangdana",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "galangdana-dev-secret",
  bucket: process.env.MEDIA_S3_PRIVATE_BUCKET ?? "campaign-documents",
  region: "us-east-1",
});

function extractExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ALLOWED_DOCUMENT_EXTENSIONS.includes(ext) ? ext : null;
}
```

Chain both new endpoints after `.put("/:id/beneficiary", ...)` from Task 9:

```ts
  .post(
    "/:id/documents/presign",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const ext = extractExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }

      const objectKey = `drafts/${params.id}/${body.type}/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = documentsS3.file(objectKey).presign({
        method: "PUT",
        expiresIn: expiresInSeconds,
      });

      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String() }),
      body: PresignDocumentUploadBodySchema,
      response: {
        200: PresignDocumentUploadResponseSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
        422: CampaignDraftErrorSchema,
      },
    },
  )
  .post(
    "/:id/documents",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [draft] = await db
        .select({ id: campaignDrafts.id })
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, params.id), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      // Must match this draft's own presign prefix exactly -- rejects a
      // client confirming an objectKey it never legitimately received a
      // presigned URL for (see this task's brief).
      if (!body.objectKey.startsWith(`drafts/${params.id}/${body.type}/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }

      const [document] = await db
        .insert(campaignDocuments)
        .values({ draftId: params.id, type: body.type, objectKey: body.objectKey })
        .returning();
      if (!document) {
        set.status = 500;
        return { error: "document_confirm_failed" };
      }

      return {
        id: document.id,
        type: document.type,
        objectKey: document.objectKey,
        uploadedAt: document.uploadedAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: ConfirmDocumentUploadBodySchema,
      response: {
        200: CampaignDocumentSchema,
        400: CampaignDraftErrorSchema,
        401: CampaignDraftErrorSchema,
        404: CampaignDraftErrorSchema,
        500: CampaignDraftErrorSchema,
      },
    },
  );
```

(Trailing semicolon moves to the end of this new last call, `.post("/:id/documents", ...)`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaign-drafts.test.ts`
Expected: PASS — 15 tests total. (This requires the private `campaign-documents` bucket to
already exist locally — Task 3, Step 6. If these tests fail with a bucket-not-found-style error,
create it first rather than treating it as a code bug.)

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add presigned document upload + confirm endpoints"
```

---

## Task 11: Minimal login page (phone OTP)

**Files:**
- Create: `apps/web/src/routes/login/+page.svelte`
- Create: `apps/web/src/routes/login/page.render.test.ts`

**Interfaces:**
- Consumes: `POST /auth/otp/request` / `POST /auth/otp/verify` (Phase 0b, unchanged), `Button`,
  `TextInput`, `FormField`, `Alert` (Phase 0c).
- Produces: `/login?redirectTo=...` — the only real authenticated-entry-point page anywhere in
  `apps/web` before this plan. Without this, nothing in this plan can be manually verified end
  to end by a real request flow, only by curling the API directly.

**Why this task exists though it's not in the plan's original "Creation wizard" scope:**
Phase 0b built the OTP request/verify API and Task 4 built the browser-to-API credentialed
request pattern, but **no page anywhere in `apps/web` has ever called an authenticated endpoint**
— every prior phase's pages were public reads. This plan's wizard is unusable and unverifiable
without a way to actually obtain a session cookie through the browser-facing app. Kept
deliberately minimal: phone input → OTP code input → done. No registration, no email/Google
paths, no session management UI — those belong to a real "Donor account"/auth-UI phase, out of
scope here.

- [ ] **Step 1: Implement `apps/web/src/routes/login/+page.svelte`**

Client-side only — no `+page.ts`/`+page.server.ts` needed, this page has no data to load, only
an interactive form making its own client-side authenticated-adjacent calls (the OTP endpoints
themselves don't require an existing session).

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Alert, Button, FormField, TextInput } from "@galangdana/ui";
import { api } from "$lib/api-client";

type Stage = "phone" | "code";

let stage: Stage = $state("phone");
let phone = $state("");
let code = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

const redirectTo = $derived(page.url.searchParams.get("redirectTo") ?? "/");

async function requestOtp() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.auth.otp.request.post({ phone });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim kode OTP. Periksa nomor telepon Anda.";
    return;
  }
  stage = "code";
}

async function verifyOtp() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.auth.otp.verify.post({ phone, code });
  submitting = false;
  if (apiError) {
    error = "Kode OTP salah atau kedaluwarsa.";
    return;
  }
  await goto(redirectTo);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Masuk ke GalangDana</h1>

  {#if error}
    <div class="mb-4">
      <Alert variant="error">{error}</Alert>
    </div>
  {/if}

  {#if stage === "phone"}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        requestOtp();
      }}
    >
      <FormField label="Nomor telepon" id="phone" hint="Contoh: +6281234567890">
        <TextInput id="phone" type="tel" bind:value={phone} required />
      </FormField>
      <Button type="submit" disabled={submitting}>Kirim kode OTP</Button>
    </form>
  {:else}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        verifyOtp();
      }}
    >
      <FormField label="Kode OTP" id="code" hint="Kode 6 digit yang baru saja dikirim">
        <TextInput id="code" type="text" bind:value={code} required maxlength={6} />
      </FormField>
      <Button type="submit" disabled={submitting}>Verifikasi</Button>
    </form>
  {/if}
</div>
```

- [ ] **Step 2: Read `packages/ui`'s actual `TextInput`/`Button`/`Alert` prop signatures before
  trusting the snippet above** — this brief's code was written from memory of Phase 0c's
  components, not re-verified against their current source. Read
  `packages/ui/src/components/TextInput.svelte`, `Button.svelte`, and `Alert.svelte` directly.
  Specifically confirm: does `TextInput` support `bind:value` (it should, per Phase 0c's own
  design — it's the one component in that package that keeps `let` for a genuinely-reassigned
  prop) and a `maxlength` passthrough attribute; does `Button` accept a `disabled` prop; does
  `Alert` accept `variant="error"`. If anything doesn't match, use the real prop name/shape and
  note the correction as a Deviation in your report — do not silently invent a new prop on these
  existing components.

- [ ] **Step 3: Write the rendering test — `apps/web/src/routes/login/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

describe("(login) page rendering", () => {
  test("shows the phone input by default", () => {
    render(Page);
    expect(screen.getByText("Masuk ke GalangDana")).not.toBeNull();
    expect(screen.getByLabelText("Nomor telepon")).not.toBeNull();
  });
});
```

(This deliberately only tests the initial render, not the full OTP request/verify flow — that
flow makes real network calls to `api.auth.otp.*`, which a component-render test has no server
to talk to. Step 4's manual verification exercises the real flow end to end instead, matching
this plan's established pattern of pairing a thin render test with a real manual check for any
page whose real behavior depends on live infrastructure.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/login/page.render.test.ts"`
Expected: PASS — 1 test.

- [ ] **Step 5: Manually verify the real login flow end to end**

With `apps/api` and `apps/web` both running locally (`API_PORT`/`PUBLIC_API_URL` workaround if
port 3001 is occupied, matching earlier phases), and since no real browser is available in this
environment: verify the PAGE renders correctly via `curl http://localhost:5173/login`, then
verify the underlying flow works via the same `curl`-based OTP request/verify sequence Task 4's
Step 9 already exercises (request → read the dev-mode code from `apps/api`'s stdout → verify →
confirm a `session` cookie is set) — this task's own contribution is confirming the PAGE ITSELF
renders without error and contains the expected form elements; the OTP mechanics were already
verified in Task 4. Report the actual curl output.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add minimal phone-OTP login page"
```

---

## Task 12: Wizard layout shell — SSR auth, step order, progress nav

**Files:**
- Create: `apps/web/src/lib/server-api-client.ts`
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/step-order.ts`
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.server.ts`
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.svelte`
- Test: `apps/web/src/routes/(campaigner)/create/[draftId]/step/step-order.test.ts`

**Interfaces:**
- Consumes: `GET /campaign-drafts/:id` (Task 6), `sessionDerive`'s cookie name convention (Task
  4), the Eden Treaty kebab-case bracket-notation call (this plan's Global Constraint).
- Produces: `createServerApiClient` (reused by every later `+page.server.ts` task in this plan),
  `STEP_ORDER` (reused by every step page to compute next/prev), the layout every step page
  (Tasks 14–20) renders inside.

**Step order** (a design decision this plan makes, since the master plan verified route names but
not their exact order): both tracks share `tujuan → judul → target-donasi → cerita → ajakan →
[track-specific step] → dokumen → otp → rangkuman`; the medical track's track-specific step is
`pasien`, the non-medical track's is `penerima` (preceded by its own extra `data-diri` step,
since a non-medical campaign has no earlier point where the campaigner's own details are
collected the way a medical campaign's patient-details step implicitly covers similar ground).

- [ ] **Step 1: Write the failing test — `apps/web/src/routes/(campaigner)/create/[draftId]/step/step-order.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { getStepOrder, nextStep, previousStep } from "./step-order";

describe("step-order", () => {
  test("medical track order", () => {
    expect(getStepOrder("medical")).toEqual([
      "tujuan",
      "judul",
      "target-donasi",
      "cerita",
      "ajakan",
      "pasien",
      "dokumen",
      "otp",
      "rangkuman",
    ]);
  });

  test("non_medical track order", () => {
    expect(getStepOrder("non_medical")).toEqual([
      "data-diri",
      "tujuan",
      "judul",
      "target-donasi",
      "cerita",
      "ajakan",
      "penerima",
      "dokumen",
      "otp",
      "rangkuman",
    ]);
  });

  test("nextStep returns the following step, or null at the end", () => {
    expect(nextStep("medical", "tujuan")).toBe("judul");
    expect(nextStep("medical", "rangkuman")).toBeNull();
  });

  test("previousStep returns the prior step, or null at the start", () => {
    expect(previousStep("non_medical", "tujuan")).toBe("data-diri");
    expect(previousStep("medical", "tujuan")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/step-order.test.ts"`
Expected: FAIL — `Cannot find module './step-order'`.

- [ ] **Step 3: Implement `apps/web/src/routes/(campaigner)/create/[draftId]/step/step-order.ts`**

```ts
type Track = "medical" | "non_medical";

const SHARED_PREFIX = ["tujuan", "judul", "target-donasi", "cerita", "ajakan"] as const;
const SHARED_SUFFIX = ["dokumen", "otp", "rangkuman"] as const;

export function getStepOrder(track: Track): string[] {
  const trackSpecific = track === "medical" ? ["pasien"] : ["penerima"];
  const prefix = track === "medical" ? SHARED_PREFIX : ["data-diri", ...SHARED_PREFIX];
  return [...prefix, ...trackSpecific, ...SHARED_SUFFIX];
}

export function nextStep(track: Track, currentStep: string): string | null {
  const order = getStepOrder(track);
  const index = order.indexOf(currentStep);
  if (index === -1 || index === order.length - 1) return null;
  return order[index + 1] ?? null;
}

export function previousStep(track: Track, currentStep: string): string | null {
  const order = getStepOrder(track);
  const index = order.indexOf(currentStep);
  if (index <= 0) return null;
  return order[index - 1] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/step-order.test.ts"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Implement the server-side authenticated API client helper — `apps/web/src/lib/server-api-client.ts`**

```ts
import { env } from "$env/dynamic/public";
import { treaty } from "@elysiajs/eden";
import type { App } from "@galangdana/api";

const API_URL = env.PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * A server-side (SSR) authenticated Eden Treaty client, scoped to ONE
 * incoming request's session cookie.
 *
 * This is deliberately NOT the same client instance as $lib/api-client.ts's
 * shared `api` singleton: that one relies on the BROWSER's own cookie jar
 * (`credentials: "include"`), which only exists for client-side requests.
 * A server-side `load` function has no browser cookie jar to opt into --
 * SvelteKit's own server-side `fetch` does not automatically forward an
 * incoming request's cookies to a DIFFERENT origin (apps/api is a
 * different port/origin from apps/web even in local dev) -- so the
 * cookie must be read explicitly (via `event.cookies.get(...)` in the
 * calling `+layout.server.ts`/`+page.server.ts`) and passed in here.
 *
 * Must match apps/api's SESSION_COOKIE constant (apps/api/src/lib/session.ts)
 * -- not imported directly since apps/web and apps/api are separate apps
 * with no established cross-app source import convention in this repo.
 */
export function createServerApiClient(sessionToken: string | undefined) {
  return treaty<App>(API_URL, {
    headers: sessionToken ? { cookie: `session=${sessionToken}` } : undefined,
  });
}
```

- [ ] **Step 6: Implement the layout's server load — `apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.server.ts`**

```ts
import { error, redirect } from "@sveltejs/kit";
import { createServerApiClient } from "$lib/server-api-client";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }

  const client = createServerApiClient(sessionToken);
  // Bracket notation is required for this kebab-case route prefix -- see
  // this plan's Global Constraint; api.campaignDrafts(...) silently 404s.
  const { data: draft, error: apiError } = await client["campaign-drafts"]({
    id: params.draftId,
  }).get();

  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  if (apiError?.status === 404 || !draft) {
    error(404, "Draft tidak ditemukan");
  }

  return { draft };
};
```

- [ ] **Step 7: Implement the layout shell — `apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.svelte`**

Read `packages/ui/src/components/Card.svelte`'s real `padded` prop default (established in Task
9 of Phase 1: defaults to `true`) before using it below — confirm this brief's assumed usage is
still accurate rather than trusting it blindly.

```svelte
<script lang="ts">
import { Card } from "@galangdana/ui";
import type { LayoutProps } from "./$types";
import { getStepOrder } from "./step-order";

const { data, children }: LayoutProps = $props();

const stepOrder = $derived(getStepOrder(data.draft.track));
const currentIndex = $derived(stepOrder.indexOf(data.draft.currentStep));
</script>

<div class="mx-auto max-w-md px-4 py-6">
  <div class="mb-6">
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
      <div
        class="h-full rounded-full bg-primary transition-all"
        style="width: {((currentIndex + 1) / stepOrder.length) * 100}%"
      ></div>
    </div>
    <p class="mt-2 font-sans text-xs text-neutral-600">
      Langkah {currentIndex + 1} dari {stepOrder.length}
    </p>
  </div>

  <Card>
    {@render children()}
  </Card>
</div>
```

- [ ] **Step 8: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean. (`vite build` succeeding here is a meaningful check on its own: this is the
first `+layout.server.ts` anywhere in `apps/web`, and the first file importing
`$lib/server-api-client.ts` — a real compile-time exercise of the new SSR auth path, even though
Step 9 is what actually exercises it at runtime.)

- [ ] **Step 9: Manually verify the redirect-when-unauthenticated path**

With `apps/api` and `apps/web` running locally: `curl -i http://localhost:5173/create/<any-uuid>/step`
(no cookie) — expect a `303` redirect to `/login?redirectTo=...`. This alone can be verified
without a real draft existing yet; the authenticated "loads a real draft" path is exercised by
Task 13 onward, once a draft can actually be created through the UI. Report the actual response
headers.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): add wizard layout shell with SSR auth and step progress"
```

---

## Task 13: `GET /categories` + onboarding pages (info, select-category, document-sample)

**Files:**
- Create: `apps/api/src/routes/categories.ts`
- Create: `apps/api/src/routes/categories.test.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/web/src/routes/(campaigner)/create/info/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/create/select-category/+page.server.ts`
- Create: `apps/web/src/routes/(campaigner)/create/select-category/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/create/document-sample/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/create/select-category/page.render.test.ts`

**Interfaces:**
- Consumes: `campaignCategories` (Phase 0a), `CampaignCategorySchema` (Phase 1),
  `getStepOrder` (Task 12), `POST /campaign-drafts` (Task 6).
- Produces: `categoriesRoute`, the entry sequence a real user hits before reaching the wizard's
  draft-scoped steps. `select-category` is where a `campaign_drafts` row actually gets created.

`GET /categories` did not exist before this task — no earlier phase needed a bare category list
(Phase 1's explore page filters by a slug already known from the URL, never lists all 17).
Public, unauthenticated, matching every other read-only Phase 1 endpoint's pattern.

- [ ] **Step 1: Write the failing API test — `apps/api/src/routes/categories.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { app } from "../index";

describe("GET /categories", () => {
  test("returns all seeded categories", async () => {
    const resp = await app.handle(new Request("http://localhost/categories"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { categories: Array<{ id: number; slug: string }> };
    expect(body.categories.length).toBe(17);
    expect(body.categories.some((c) => c.slug === "bencana-alam")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/categories.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `apps/api/src/routes/categories.ts`**

```ts
import { CampaignCategorySchema } from "@galangdana/contracts";
import { campaignCategories, db } from "@galangdana/db";
import { Elysia, t } from "elysia";

export const categoriesRoute = new Elysia().get(
  "/categories",
  async () => {
    const categories = await db.select().from(campaignCategories);
    return { categories };
  },
  { response: { 200: t.Object({ categories: t.Array(CampaignCategorySchema) }) } },
);
```

- [ ] **Step 4: Wire the route — modify `apps/api/src/index.ts`**

Add the import and `.use(categoriesRoute)` alongside the existing route uses.

- [ ] **Step 5: Run the test to verify it passes, then the full suite/lint/typecheck**

Run: `cd apps/api && bun test src/routes/categories.test.ts` — expect PASS, 1 test.
Run: `cd apps/api && bun test && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck` — expect all clean.

- [ ] **Step 6: Commit the API piece**

```bash
git add apps/api
git commit -m "feat(api): add GET /categories"
```

- [ ] **Step 7: Implement `apps/web/src/routes/(campaigner)/create/info/+page.svelte`**

Static explainer, no data loading. Read `packages/ui/src/components/Button.svelte`'s real props
before using it (confirm `href` works as a link-styled button, or use a plain `<a>` styled with
the same token classes if `Button` doesn't support rendering as an anchor — check its source
rather than assuming).

```svelte
<div class="mx-auto max-w-md px-4 py-12">
  <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Galang Dana untuk Kebaikan</h1>
  <p class="mb-6 font-sans text-neutral-600">
    Buat campaign penggalangan dana dalam beberapa langkah. Siapkan cerita, target donasi, dan
    dokumen pendukung sebelum memulai.
  </p>
  <a
    href="/create/select-category"
    class="inline-block rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark"
  >
    Mulai
  </a>
</div>
```

- [ ] **Step 8: Implement `apps/web/src/routes/(campaigner)/create/document-sample/+page.svelte`**

```svelte
<div class="mx-auto max-w-md px-4 py-12">
  <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Dokumen yang Perlu Disiapkan</h1>
  <p class="mb-4 font-sans text-neutral-600">
    Setiap campaign membutuhkan dokumen pendukung agar dapat diverifikasi dan dipercaya oleh
    calon donatur. Siapkan salah satu dari dokumen berikut sesuai kategori campaign Anda:
  </p>
  <ul class="mb-6 list-disc space-y-1 pl-5 font-sans text-sm text-neutral-600">
    <li>Riwayat medis atau tagihan rumah sakit (untuk campaign medis)</li>
    <li>Kartu pelajar/mahasiswa atau tagihan institusi pendidikan (untuk beasiswa)</li>
    <li>Foto sumber kejadian atau tautan media sosial terkait</li>
  </ul>
  <a
    href="/create/select-category"
    class="inline-block rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark"
  >
    Lanjutkan
  </a>
</div>
```

- [ ] **Step 9: Write the failing test — `apps/web/src/routes/(campaigner)/create/select-category/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const CATEGORIES = [
  { id: 22, slug: "bencana-alam", title: "Bencana Alam" },
  { id: 8, slug: "balita-anak-sakit", title: "Balita & Anak Sakit" },
];

describe("select-category page rendering", () => {
  test("renders a track choice and the category list", () => {
    render(Page, { props: { data: { categories: CATEGORIES } } });
    expect(screen.getByText("Bencana Alam")).not.toBeNull();
    expect(screen.getByText("Balita & Anak Sakit")).not.toBeNull();
    expect(screen.getByLabelText(/[Mm]edis/)).not.toBeNull();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/select-category/page.render.test.ts"`
Expected: FAIL — the route/component doesn't exist yet.

- [ ] **Step 11: Implement the server load — `apps/web/src/routes/(campaigner)/create/select-category/+page.server.ts`**

```ts
import { redirect } from "@sveltejs/kit";
import { createServerApiClient } from "$lib/server-api-client";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { data } = await client.categories.get();
  return { categories: data?.categories ?? [] };
};
```

- [ ] **Step 12: Implement the page — `apps/web/src/routes/(campaigner)/create/select-category/+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { getStepOrder } from "../[draftId]/step/step-order";

const { data }: PageProps = $props();

let track: "medical" | "non_medical" = $state("medical");
let categoryId = $state<number | undefined>(data.categories[0]?.id);
let submitting = $state(false);
let error = $state<string | null>(null);

async function createDraft() {
  error = null;
  submitting = true;
  // Bracket notation required -- see this plan's Global Constraint on
  // Eden Treaty's kebab-case route handling.
  const { data: draft, error: apiError } = await api["campaign-drafts"].post({
    track,
    categoryId,
  });
  submitting = false;
  if (apiError || !draft) {
    error = "Gagal membuat draft campaign. Silakan coba lagi.";
    return;
  }
  const firstStep = getStepOrder(draft.track)[0];
  await goto(`/create/${draft.id}/step/${firstStep}`);
}
</script>

<div class="mx-auto max-w-md px-4 py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Pilih Jenis Campaign</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-error">{error}</p>
  {/if}

  <form
    onsubmit={(e) => {
      e.preventDefault();
      createDraft();
    }}
  >
    <fieldset class="mb-4">
      <legend class="mb-2 font-sans text-sm font-medium text-neutral-900">Jenis campaign</legend>
      <label class="mb-1 flex items-center gap-2 font-sans text-sm">
        <input type="radio" bind:group={track} value="medical" />
        Medis
      </label>
      <label class="flex items-center gap-2 font-sans text-sm">
        <input type="radio" bind:group={track} value="non_medical" />
        Non-medis
      </label>
    </fieldset>

    <div class="mb-6">
      <label for="category" class="mb-2 block font-sans text-sm font-medium text-neutral-900">
        Kategori
      </label>
      <select
        id="category"
        bind:value={categoryId}
        class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base"
      >
        {#each data.categories as category (category.id)}
          <option value={category.id}>{category.title}</option>
        {/each}
      </select>
    </div>

    <button
      type="submit"
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Buat Draft
    </button>
  </form>
</div>
```

- [ ] **Step 13: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/select-category/page.render.test.ts"`
Expected: PASS — 1 test.

- [ ] **Step 14: Manually verify the real create-draft flow end to end**

With `apps/api` and `apps/web` running locally, and a valid session cookie obtained via the
Task 11/Task 4 OTP flow: `curl -b /tmp/cookies.txt http://localhost:5173/create/select-category`
should render 200 with all 17 categories present in the HTML. A real form submission can't be
driven via curl (it's a client-side `fetch` triggered by a DOM event, not a plain form POST) —
instead, directly verify the underlying API call `curl -b /tmp/cookies.txt -X POST
http://localhost:3011/campaign-drafts -H "content-type: application/json" -d
'{"track":"medical","categoryId":22}'` returns a real draft with `currentStep: "info"`, closing
the loop on what the page's `createDraft()` function does. Report actual output.

- [ ] **Step 15: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 16: Commit**

```bash
git add apps/web
git commit -m "feat(web): add info, select-category, and document-sample onboarding pages"
```

---

## Task 14: Simple-field wizard steps (batched) — `tujuan`, `judul`, `target-donasi`, `ajakan`, `data-diri`

This is ONE dispatch covering 5 nearly-identical pages, batched per this project's established
same-shape-work guidance rather than 5 separate task cycles. All 5 render inside the Task 12
layout (`data.draft` already available via SvelteKit's ancestor-layout data inheritance — none
of these needs its own `+page.server.ts`), save through `PATCH /campaign-drafts/:id/answers`
(Task 7), and advance via `nextStep`/`previousStep` (Task 12).

**Files (5 pages + 5 tests, all new):**
- `apps/web/src/routes/(campaigner)/create/[draftId]/step/tujuan/+page.svelte` (+ `page.render.test.ts`)
- `apps/web/src/routes/(campaigner)/create/[draftId]/step/judul/+page.svelte` (+ `page.render.test.ts`)
- `apps/web/src/routes/(campaigner)/create/[draftId]/step/target-donasi/+page.svelte` (+ `page.render.test.ts`)
- `apps/web/src/routes/(campaigner)/create/[draftId]/step/ajakan/+page.svelte` (+ `page.render.test.ts`)
- `apps/web/src/routes/(campaigner)/create/[draftId]/step/data-diri/+page.svelte` (+ `page.render.test.ts`) —
  **non-medical track only**; still build the page (it's harmless to visit for a medical draft,
  since `step-order.ts`'s `getStepOrder("medical")` never includes `"data-diri"` and no medical
  draft's wizard nav ever links to it), no track-gating logic needed inside the page itself.

**Interfaces:**
- Consumes: `data.draft` (Task 12's layout), `PATCH /campaign-drafts/:id/answers` (Task 7),
  `nextStep`/`previousStep` (Task 12), the Eden Treaty bracket-notation call.
- Produces: 5 working wizard steps.

**The shared shape** (write this once, then apply the field table below to produce all 5 files —
do not deviate from this structure per-page beyond what the table specifies):

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextStep, previousStep } from "../step-order";

const STEP = "<STEP_NAME>"; // exact value from the field table below
const ANSWER_KEY = "<ANSWER_KEY>"; // exact value from the field table below

const { data }: PageProps = $props();

let value = $state(String(data.draft.answers[ANSWER_KEY] ?? ""));
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next" && !value.trim()) {
    error = "Kolom ini wajib diisi.";
    return;
  }
  submitting = true;
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).answers.patch({
    step: STEP,
    answers: { [ANSWER_KEY]: value },
  });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next" ? nextStep(data.draft.track, STEP) : previousStep(data.draft.track, STEP);
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900"><STEP_HEADING></h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <label for={ANSWER_KEY} class="mb-2 block font-sans text-sm font-medium text-neutral-900">
    <STEP_LABEL>
  </label>
  <<INPUT_TAG> id={ANSWER_KEY} bind:value class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base" <EXTRA_INPUT_ATTRS> />

  <div class="mt-6 flex justify-between">
    <button
      type="button"
      onclick={() => save("back")}
      disabled={submitting}
      class="font-sans text-sm text-neutral-600 disabled:opacity-50"
    >
      Kembali
    </button>
    <button
      type="button"
      onclick={() => save("next")}
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Lanjutkan
    </button>
  </div>
</div>
```

**Field table** (fill in the `<PLACEHOLDER>` tokens above per row — these are NOT literal
placeholders left in the shipped code, they are this brief's way of specifying 5 concrete files
without repeating the whole template 5 times; every shipped file has real, concrete values, no
`<...>` tokens anywhere):

| File dir | `STEP` | `ANSWER_KEY` | Heading | Label | Input tag | Extra attrs |
|---|---|---|---|---|---|---|
| `tujuan` | `"tujuan"` | `"purpose"` | `Apa tujuan penggalangan dana ini?` | `Jelaskan tujuan secara singkat` | `textarea` | `rows="3"` |
| `judul` | `"judul"` | `"title"` | `Judul Campaign` | `Judul yang menarik dan jelas` | `input type="text"` | (none) |
| `target-donasi` | `"target-donasi"` | `"goalAmountStr"` | `Target Donasi` | `Jumlah target (Rp)` | `input type="number" min="10000" step="1000"` | (none) |
| `ajakan` | `"ajakan"` | `"callToAction"` | `Ajakan untuk Donatur` | `Kalimat ajakan singkat` | `input type="text"` | (none) |
| `data-diri` | `"data-diri"` | `"campaignerRole"` | `Peran Anda` | `Apa peran Anda dalam penggalangan dana ini?` | `input type="text"` | `placeholder="Contoh: Warga setempat, Panitia"` |

For the `textarea` row (`tujuan`), the tag is `<textarea id={ANSWER_KEY} bind:value ...></textarea>`
(closing tag, not self-closing) — adjust the template's self-closing `<INPUT_TAG ... />` syntax
accordingly for that one file only.

- [ ] **Step 1: Write the 5 failing tests** — one `page.render.test.ts` per directory, each
  following this exact shape (shown for `tujuan`; apply the same pattern with each row's own
  heading/label text to the other 4):

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "tujuan",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("tujuan step rendering", () => {
  test("renders the heading and an empty input by default", () => {
    render(Page, { props: { data: { draft: DRAFT } } });
    expect(screen.getByText("Apa tujuan penggalangan dana ini?")).not.toBeNull();
  });

  test("pre-fills the input from an existing draft answer", () => {
    render(Page, {
      props: { data: { draft: { ...DRAFT, answers: { purpose: "Biaya operasi" } } } },
    });
    expect(screen.getByLabelText("Jelaskan tujuan secara singkat")).toHaveValue("Biaya operasi");
  });
});
```

(Adapt the second test's field/value per row — e.g. `judul`'s test pre-fills `{ title: "..." }`
and checks `getByLabelText("Judul yang menarik dan jelas")`.)

- [ ] **Step 2: Run all 5 to verify they fail**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/{tujuan,judul,target-donasi,ajakan,data-diri}/page.render.test.ts"`
Expected: FAIL — none of the 5 components exist yet.

- [ ] **Step 3: Implement all 5 pages** per the shared shape + field table above.

- [ ] **Step 4: Run all 5 to verify they pass**

Same command as Step 2. Expected: PASS — 10 tests total (2 per page).

- [ ] **Step 5: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add tujuan/judul/target-donasi/ajakan/data-diri wizard steps"
```

---

## Task 15: `cerita` step — guided (6/7 questions) or manual story

**Files:**
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/cerita/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/cerita/guided-questions.ts`
- Test: `apps/web/src/routes/(campaigner)/create/[draftId]/step/cerita/page.render.test.ts`

**Interfaces:**
- Consumes: `data.draft` (Task 12 — note this is the FULL `CampaignDraftDetailResponse`, not a
  trimmed object; `GET /campaign-drafts/:id` only has one response shape, so Task 12's layout
  already loads `storyAnswers`/`manualStory`/`patient`/`beneficiary`/`documents` alongside the
  bare draft fields, and every child step page gets all of it via SvelteKit's ordinary
  ancestor-layout data inheritance — no step needs its own `+page.server.ts` re-fetch of the same
  endpoint), `PUT /campaign-drafts/:id/story` (Task 8), `nextStep`/`previousStep` (Task 12).
- Produces: the wizard's guided story builder — 6 questions for `medical`, 7 for `non_medical`,
  each with a `manual` freeform escape hatch, matching the master plan's verified route
  structure (`cerita(guided 1-6|manual)` medical, `guided 1-7` non-medical).

Original question text — not copied from any observed platform (only the guided-1..N step count
was ever verified, never the actual question wording).

- [ ] **Step 1: Implement `apps/web/src/routes/(campaigner)/create/[draftId]/step/cerita/guided-questions.ts`**

```ts
type Track = "medical" | "non_medical";

const MEDICAL_QUESTIONS = [
  "Sejak kapan kondisi ini dialami?",
  "Apa diagnosis atau kondisi medis yang dihadapi?",
  "Tindakan medis apa yang sudah dilakukan sejauh ini?",
  "Mengapa bantuan ini dibutuhkan sekarang?",
  "Bagaimana dana yang terkumpul akan digunakan?",
  "Apa harapan Anda untuk pasien ke depannya?",
] as const;

const NON_MEDICAL_QUESTIONS = [
  "Apa latar belakang atau situasi yang mendasari penggalangan dana ini?",
  "Siapa yang akan menerima manfaat dari dana ini?",
  "Apa dampak yang diharapkan dari campaign ini?",
  "Bagaimana dana akan digunakan secara rinci?",
  "Apakah ada upaya lain yang sudah dilakukan sebelumnya?",
  "Mengapa bantuan ini mendesak?",
  "Apa harapan Anda untuk keberlanjutan setelah campaign ini selesai?",
] as const;

export function getGuidedQuestions(track: Track): readonly string[] {
  return track === "medical" ? MEDICAL_QUESTIONS : NON_MEDICAL_QUESTIONS;
}
```

- [ ] **Step 2: Write the failing test — `apps/web/src/routes/(campaigner)/create/[draftId]/step/cerita/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "cerita",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("cerita step rendering", () => {
  test("defaults to guided mode, showing 6 questions for a medical draft", () => {
    render(Page, {
      props: { data: { draft: { ...DRAFT, storyAnswers: [], manualStory: null } } },
    });
    expect(screen.getByText("Sejak kapan kondisi ini dialami?")).not.toBeNull();
    expect(screen.getAllByRole("textbox").length).toBe(6);
  });

  test("shows 7 questions for a non_medical draft", () => {
    render(Page, {
      props: {
        data: {
          draft: { ...DRAFT, track: "non_medical", storyAnswers: [], manualStory: null },
        },
      },
    });
    expect(screen.getAllByRole("textbox").length).toBe(7);
  });

  test("switching to manual mode shows one freeform textarea instead", async () => {
    render(Page, {
      props: { data: { draft: { ...DRAFT, storyAnswers: [], manualStory: null } } },
    });
    const manualToggle = screen.getByText("Tulis manual");
    manualToggle.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByRole("textbox").length).toBe(1);
  });

  test("pre-fills manual mode when the draft already has a manual story and no guided answers", () => {
    render(Page, {
      props: {
        data: {
          draft: { ...DRAFT, storyAnswers: [], manualStory: "Cerita yang sudah ditulis." },
        },
      },
    });
    expect(screen.getByText("Cerita yang sudah ditulis.")).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/cerita/page.render.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 4: Implement the page — `apps/web/src/routes/(campaigner)/create/[draftId]/step/cerita/+page.svelte`**

No `+page.server.ts` needed for this step — `data.draft.storyAnswers`/`data.draft.manualStory`
are already present via Task 12's layout, per this task's Interfaces note above.

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextStep, previousStep } from "../step-order";
import { getGuidedQuestions } from "./guided-questions";

const { data }: PageProps = $props();

const questions = getGuidedQuestions(data.draft.track);

// Guided mode is the default UNLESS the draft already has a manual story
// and no guided answers -- matches the invariant Task 8's API enforces
// (a draft never has both simultaneously).
let mode: "guided" | "manual" = $state(
  data.draft.manualStory && data.draft.storyAnswers.length === 0 ? "manual" : "guided",
);
let guidedAnswers: string[] = $state(
  questions.map(
    (_, i) => data.draft.storyAnswers.find((a) => a.questionNumber === i + 1)?.answerText ?? "",
  ),
);
let manualText = $state(data.draft.manualStory ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next") {
    const incomplete =
      mode === "guided" ? guidedAnswers.some((a) => !a.trim()) : !manualText.trim();
    if (incomplete) {
      error = "Lengkapi cerita campaign sebelum melanjutkan.";
      return;
    }
  }
  submitting = true;
  const body =
    mode === "guided"
      ? {
          mode: "guided" as const,
          answers: guidedAnswers.map((answerText, i) => ({ questionNumber: i + 1, answerText })),
        }
      : { mode: "manual" as const, text: manualText };
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).story.put(body);
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan cerita. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "cerita")
      : previousStep(data.draft.track, "cerita");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Cerita Campaign</h2>

  <div class="mb-4 flex gap-4 font-sans text-sm">
    <button
      type="button"
      onclick={() => (mode = "guided")}
      class={mode === "guided" ? "font-semibold text-primary" : "text-neutral-600"}
    >
      Ikuti panduan
    </button>
    <button
      type="button"
      onclick={() => (mode = "manual")}
      class={mode === "manual" ? "font-semibold text-primary" : "text-neutral-600"}
    >
      Tulis manual
    </button>
  </div>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if mode === "guided"}
    {#each questions as question, i (i)}
      <div class="mb-4">
        <label for="q-{i}" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
          {question}
        </label>
        <textarea
          id="q-{i}"
          bind:value={guidedAnswers[i]}
          rows="2"
          class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
        ></textarea>
      </div>
    {/each}
  {:else}
    <textarea
      bind:value={manualText}
      rows="10"
      class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
      placeholder="Tuliskan cerita lengkap campaign Anda di sini..."
    ></textarea>
  {/if}

  <div class="mt-6 flex justify-between">
    <button
      type="button"
      onclick={() => save("back")}
      disabled={submitting}
      class="font-sans text-sm text-neutral-600 disabled:opacity-50"
    >
      Kembali
    </button>
    <button
      type="button"
      onclick={() => save("next")}
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Lanjutkan
    </button>
  </div>
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/cerita/page.render.test.ts"`
Expected: PASS — 4 tests.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add cerita step with guided (6/7 question) and manual modes"
```

---

## Task 16: `pasien` (medical) + `penerima` (non-medical) steps — batched

**Files:**
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/pasien/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/create/[draftId]/step/pasien/page.render.test.ts`
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/penerima/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/create/[draftId]/step/penerima/page.render.test.ts`

**Interfaces:**
- Consumes: `data.draft` (Task 12 — the FULL `CampaignDraftDetailResponse`, including
  `patient`/`beneficiary` already; see Task 15's Interfaces note on why no step needs its own
  `+page.server.ts` re-fetch of this same data), `PUT /campaign-drafts/:id/patient` /
  `PUT /campaign-drafts/:id/beneficiary` (Task 9), `nextStep`/`previousStep` (Task 12).
- Produces: the two track-specific "who is this for" steps.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/routes/(campaigner)/create/[draftId]/step/pasien/page.render.test.ts`:

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "pasien",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("pasien step rendering", () => {
  test("renders empty patient fields by default", () => {
    render(Page, { props: { data: { draft: { ...DRAFT, patient: null } } } });
    expect(screen.getByLabelText("Nama pasien")).toHaveValue("");
  });

  test("pre-fills from an existing patient record", () => {
    render(Page, {
      props: {
        data: {
          draft: {
            ...DRAFT,
            patient: {
              name: "Aldi",
              age: 2,
              illness: "Kelainan jantung",
              hospitalName: null,
              relationshipToCampaigner: null,
            },
          },
        },
      },
    });
    expect(screen.getByLabelText("Nama pasien")).toHaveValue("Aldi");
    expect(screen.getByLabelText("Kondisi/penyakit")).toHaveValue("Kelainan jantung");
  });
});
```

`apps/web/src/routes/(campaigner)/create/[draftId]/step/penerima/page.render.test.ts`:

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "22222222-2222-2222-2222-222222222222",
  track: "non_medical" as const,
  categoryId: 23,
  currentStep: "penerima",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("penerima step rendering", () => {
  test("renders empty beneficiary fields by default", () => {
    render(Page, { props: { data: { draft: { ...DRAFT, beneficiary: null } } } });
    expect(screen.getByLabelText("Nama penerima manfaat")).toHaveValue("");
  });

  test("pre-fills from an existing beneficiary record", () => {
    render(Page, {
      props: {
        data: {
          draft: {
            ...DRAFT,
            beneficiary: {
              name: "Warga Desa Sukamaju",
              relationship: null,
              needDescription: "Renovasi musala",
            },
          },
        },
      },
    });
    expect(screen.getByLabelText("Nama penerima manfaat")).toHaveValue("Warga Desa Sukamaju");
  });
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/{pasien,penerima}/page.render.test.ts"`
Expected: FAIL — neither component exists.

- [ ] **Step 3: Implement the `pasien` step — `+page.svelte`** (no `+page.server.ts` needed)

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextStep, previousStep } from "../step-order";

const { data }: PageProps = $props();

let name = $state(data.draft.patient?.name ?? "");
let age = $state(data.draft.patient?.age != null ? String(data.draft.patient.age) : "");
let illness = $state(data.draft.patient?.illness ?? "");
let hospitalName = $state(data.draft.patient?.hospitalName ?? "");
let relationshipToCampaigner = $state(data.draft.patient?.relationshipToCampaigner ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next" && (!name.trim() || !illness.trim())) {
    error = "Nama dan kondisi pasien wajib diisi.";
    return;
  }
  submitting = true;
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).patient.put({
    name,
    age: age ? Number(age) : undefined,
    illness,
    hospitalName: hospitalName || undefined,
    relationshipToCampaigner: relationshipToCampaigner || undefined,
  });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan data pasien. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "pasien")
      : previousStep(data.draft.track, "pasien");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Data Pasien</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="patient-name" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nama pasien</label>
    <input id="patient-name" type="text" bind:value={name} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-age" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Usia</label>
    <input id="patient-age" type="number" min="0" bind:value={age} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-illness" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kondisi/penyakit</label>
    <input id="patient-illness" type="text" bind:value={illness} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-hospital" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Rumah sakit (opsional)</label>
    <input id="patient-hospital" type="text" bind:value={hospitalName} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-relationship" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Hubungan dengan Anda (opsional)</label>
    <input id="patient-relationship" type="text" bind:value={relationshipToCampaigner} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
```

- [ ] **Step 4: Implement the `penerima` step — `+page.svelte`** (no `+page.server.ts` needed)

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextStep, previousStep } from "../step-order";

const { data }: PageProps = $props();

let name = $state(data.draft.beneficiary?.name ?? "");
let relationship = $state(data.draft.beneficiary?.relationship ?? "");
let needDescription = $state(data.draft.beneficiary?.needDescription ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next" && (!name.trim() || !needDescription.trim())) {
    error = "Nama dan kebutuhan penerima manfaat wajib diisi.";
    return;
  }
  submitting = true;
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).beneficiary.put({
    name,
    relationship: relationship || undefined,
    needDescription,
  });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan data penerima manfaat. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "penerima")
      : previousStep(data.draft.track, "penerima");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Data Penerima Manfaat</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="beneficiary-name" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nama penerima manfaat</label>
    <input id="beneficiary-name" type="text" bind:value={name} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="beneficiary-relationship" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Hubungan dengan Anda (opsional)</label>
    <input id="beneficiary-relationship" type="text" bind:value={relationship} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="beneficiary-need" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kebutuhan yang akan dipenuhi</label>
    <textarea id="beneficiary-need" bind:value={needDescription} rows="3" class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"></textarea>
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
```

- [ ] **Step 5: Run both to verify they pass**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/{pasien,penerima}/page.render.test.ts"`
Expected: PASS — 4 tests total.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add pasien and penerima wizard steps"
```

---

## Task 17: `dokumen` step — presigned document upload UI

**Files:**
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/dokumen/document-types.ts`
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/dokumen/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/create/[draftId]/step/dokumen/page.render.test.ts`

**Interfaces:**
- Consumes: `data.draft` (Task 12 — the FULL `CampaignDraftDetailResponse`, including `documents`
  already; see Task 15's Interfaces note on why no step needs its own `+page.server.ts` re-fetch
  of this same data), `POST /campaign-drafts/:id/documents/presign` +
  `POST /campaign-drafts/:id/documents` (Task 10), `nextStep`/`previousStep` (Task 12).
- Produces: the wizard's document-upload step, offering the document types relevant to the
  draft's track (medical: `riwayat_medis`/`tagihan_rumah_sakit`; non-medical:
  `kartu_mahasiswa`/`kartu_pelajar`/`tagihan_institusi_pendidikan`/`media_sosial`/`sumber_gambar`).

Genuinely new client-side flow (nothing in this codebase has done a real browser file upload
before this task): pick a file + type → `POST .../documents/presign` → `fetch(uploadUrl, {method:
"PUT", body: file})` directly against MinIO (never routing file bytes through the SvelteKit or
Elysia servers) → `POST .../documents` to confirm and record the row.

- [ ] **Step 1: Implement `apps/web/src/routes/(campaigner)/create/[draftId]/step/dokumen/document-types.ts`**

```ts
type Track = "medical" | "non_medical";
type DocumentType =
  | "kartu_mahasiswa"
  | "kartu_pelajar"
  | "tagihan_rumah_sakit"
  | "tagihan_institusi_pendidikan"
  | "media_sosial"
  | "sumber_gambar"
  | "riwayat_medis";

const MEDICAL_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "riwayat_medis", label: "Riwayat medis" },
  { value: "tagihan_rumah_sakit", label: "Tagihan rumah sakit" },
];

const NON_MEDICAL_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "kartu_mahasiswa", label: "Kartu mahasiswa" },
  { value: "kartu_pelajar", label: "Kartu pelajar" },
  { value: "tagihan_institusi_pendidikan", label: "Tagihan institusi pendidikan" },
  { value: "media_sosial", label: "Tautan/tangkapan layar media sosial" },
  { value: "sumber_gambar", label: "Sumber gambar" },
];

export function getDocumentTypes(track: Track) {
  return track === "medical" ? MEDICAL_TYPES : NON_MEDICAL_TYPES;
}
```

- [ ] **Step 2: Write the failing test — `apps/web/src/routes/(campaigner)/create/[draftId]/step/dokumen/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "dokumen",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("dokumen step rendering", () => {
  test("shows the medical-track document type options", () => {
    render(Page, { props: { data: { draft: { ...DRAFT, documents: [] } } } });
    expect(screen.getByText("Riwayat medis")).not.toBeNull();
    expect(screen.queryByText("Kartu mahasiswa")).toBeNull();
  });

  test("lists already-uploaded documents", () => {
    render(Page, {
      props: {
        data: {
          draft: {
            ...DRAFT,
            documents: [
              {
                id: "d1",
                type: "riwayat_medis",
                objectKey: "drafts/x/riwayat_medis/y.pdf",
                uploadedAt: new Date().toISOString(),
              },
            ],
          },
        },
      },
    });
    expect(screen.getByText("Riwayat medis", { exact: false })).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/dokumen/page.render.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 4: Implement the page — `+page.svelte`** (no `+page.server.ts` needed)

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { invalidateAll } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextStep, previousStep } from "../step-order";
import { getDocumentTypes } from "./document-types";

const { data }: PageProps = $props();

const documentTypes = getDocumentTypes(data.draft.track);

let selectedType = $state(documentTypes[0]?.value ?? "riwayat_medis");
let selectedFile: File | null = $state(null);
let uploading = $state(false);
let error = $state<string | null>(null);

function typeLabel(value: string): string {
  return documentTypes.find((t) => t.value === value)?.label ?? value;
}

async function uploadDocument() {
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  error = null;
  uploading = true;

  const { data: presign, error: presignError } = await api["campaign-drafts"]({
    id: data.draft.id,
  }).documents.presign.post({ type: selectedType, fileName: selectedFile.name });

  if (presignError || !presign) {
    uploading = false;
    error = "Gagal menyiapkan unggahan. Periksa format file (pdf/jpg/jpeg/png).";
    return;
  }

  const putResp = await fetch(presign.uploadUrl, { method: "PUT", body: selectedFile });
  if (!putResp.ok) {
    uploading = false;
    error = "Gagal mengunggah file.";
    return;
  }

  const { error: confirmError } = await api["campaign-drafts"]({ id: data.draft.id }).documents.post({
    type: selectedType,
    objectKey: presign.objectKey,
  });
  uploading = false;
  if (confirmError) {
    error = "Gagal menyimpan dokumen.";
    return;
  }

  selectedFile = null;
  await invalidateAll();
}

async function proceed(direction: "next" | "back") {
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "dokumen")
      : previousStep(data.draft.track, "dokumen");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Dokumen Pendukung</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if data.draft.documents.length > 0}
    <ul class="mb-4 space-y-1 font-sans text-sm text-neutral-600">
      {#each data.draft.documents as doc (doc.id)}
        <li>{typeLabel(doc.type)} — diunggah {new Date(doc.uploadedAt).toLocaleDateString("id-ID")}</li>
      {/each}
    </ul>
  {/if}

  <div class="mb-4">
    <label for="doc-type" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Jenis dokumen</label>
    <select id="doc-type" bind:value={selectedType} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm">
      {#each documentTypes as t (t.value)}
        <option value={t.value}>{t.label}</option>
      {/each}
    </select>
  </div>

  <div class="mb-4">
    <label for="doc-file" class="mb-1 block font-sans text-sm font-medium text-neutral-900">File (pdf, jpg, jpeg, png)</label>
    <input
      id="doc-file"
      type="file"
      accept=".pdf,.jpg,.jpeg,.png"
      onchange={(e) => (selectedFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
    />
  </div>

  <button
    type="button"
    onclick={uploadDocument}
    disabled={uploading}
    class="mb-6 rounded-sm border border-primary px-4 py-2 font-sans text-sm font-semibold text-primary disabled:opacity-50"
  >
    Unggah
  </button>

  <div class="flex justify-between">
    <button type="button" onclick={() => proceed("back")} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button type="button" onclick={() => proceed("next")} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark">Lanjutkan</button>
  </div>
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/dokumen/page.render.test.ts"`
Expected: PASS — 2 tests.

- [ ] **Step 6: Manually verify a real upload round-trip through the actual page**

With `apps/api` and `apps/web` running locally and a valid session cookie: this is a client-side
file input, which curl cannot drive directly — instead, confirm the page itself renders
correctly (`curl -b /tmp/cookies.txt http://localhost:5173/create/<real-draft-id>/step/dokumen`,
expect 200 with the medical or non-medical document type options present depending on the
draft's track), and separately confirm the underlying presign→PUT→confirm sequence works for
real (Task 10's own tests already do this against real MinIO — re-run
`cd apps/api && bun test src/routes/campaign-drafts.test.ts` here as this task's own
confirmation that nothing in this page's assumptions about that flow has drifted). Report actual
output for both checks.

- [ ] **Step 7: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): add dokumen step with presigned document upload"
```

---

## Task 18: `otp` step — phone re-confirmation before submission

**Files:**
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/otp/+page.server.ts`
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/otp/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/create/[draftId]/step/otp/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /auth/me`, `POST /auth/otp/request`, `POST /auth/otp/verify` (all Phase 0b,
  unchanged), `PATCH /campaign-drafts/:id/answers` (Task 7).
- Produces: the wizard's lightweight identity re-confirmation step, matching the master plan's
  verified route (`otp` sits in the same step sequence as `tujuan`/`judul`/etc., distinct from
  the more elaborate document-based individual KYC flow that Phase 2c builds separately).

**Deliberate scope note, not a gap to "fix":** this step reuses the existing `/auth/otp/verify`
endpoint as-is, which — as a side effect of code nobody is changing in this task — creates a
**new** session row (it always has, since Phase 0b; that endpoint's whole job is
`createSession(user.id)` on success). Re-verifying here therefore leaves the user with two valid
session cookies' worth of rows server-side (their original login session, plus this one) rather
than one. This is harmless (both belong to the same user, no security or correctness issue, just
a minor extra row) and building a dedicated non-session-creating re-verify endpoint for this one
wizard step is out of scope — the REAL identity verification with its own dedicated flow is
Phase 2c's individual KYC, not this lightweight check.

- [ ] **Step 1: Write the failing test — `apps/web/src/routes/(campaigner)/create/[draftId]/step/otp/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "otp",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("otp step rendering", () => {
  test("shows the registered phone and a button to send the code", () => {
    render(Page, { props: { data: { draft: DRAFT, phone: "+6281234567890" } } });
    expect(screen.getByText("+6281234567890", { exact: false })).not.toBeNull();
    expect(screen.getByText("Kirim kode OTP")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/otp/page.render.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 3: Implement the server load — `+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const client = createServerApiClient(cookies.get("session"));
  const { data } = await client.auth.me.get();
  return { phone: data?.user.phone ?? null };
};
```

- [ ] **Step 4: Implement the page — `+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextStep, previousStep } from "../step-order";

const { data }: PageProps = $props();

let stage: "request" | "verify" = $state("request");
let code = $state("");
let submitting = $state(false);
let error = $state<string | null>(null);

async function requestCode() {
  if (!data.phone) {
    error = "Nomor telepon tidak ditemukan pada akun Anda.";
    return;
  }
  error = null;
  submitting = true;
  const { error: apiError } = await api.auth.otp.request.post({ phone: data.phone });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim kode OTP.";
    return;
  }
  stage = "verify";
}

async function verifyAndProceed(direction: "next" | "back") {
  if (direction === "back") {
    const target = previousStep(data.draft.track, "otp");
    if (target) await goto(`/create/${data.draft.id}/step/${target}`);
    return;
  }
  if (!data.phone) return;
  error = null;
  submitting = true;
  const { error: verifyError } = await api.auth.otp.verify.post({ phone: data.phone, code });
  if (verifyError) {
    submitting = false;
    error = "Kode OTP salah atau kedaluwarsa.";
    return;
  }
  const { error: saveError } = await api["campaign-drafts"]({ id: data.draft.id }).answers.patch({
    step: "otp",
    answers: { otpConfirmedAt: new Date().toISOString() },
  });
  submitting = false;
  if (saveError) {
    error = "Gagal menyimpan konfirmasi.";
    return;
  }
  const target = nextStep(data.draft.track, "otp");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Konfirmasi Nomor Telepon</h2>
  <p class="mb-4 font-sans text-sm text-neutral-600">
    Untuk keamanan, konfirmasikan kembali nomor telepon terdaftar Anda: <strong>{data.phone}</strong>
  </p>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if stage === "request"}
    <button
      type="button"
      onclick={requestCode}
      disabled={submitting}
      class="mb-6 rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Kirim kode OTP
    </button>
  {:else}
    <div class="mb-6">
      <label for="otp-code" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kode OTP</label>
      <input id="otp-code" type="text" maxlength="6" bind:value={code} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base" />
    </div>
  {/if}

  <div class="flex justify-between">
    <button type="button" onclick={() => verifyAndProceed("back")} class="font-sans text-sm text-neutral-600">Kembali</button>
    {#if stage === "verify"}
      <button
        type="button"
        onclick={() => verifyAndProceed("next")}
        disabled={submitting}
        class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
      >
        Verifikasi &amp; Lanjutkan
      </button>
    {/if}
  </div>
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/otp/page.render.test.ts"`
Expected: PASS — 1 test.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add otp phone re-confirmation wizard step"
```

---

## Task 19: `rangkuman` step — read-only draft summary

**Files:**
- Create: `apps/web/src/routes/(campaigner)/create/[draftId]/step/rangkuman/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts`

**Interfaces:**
- Consumes: `data.draft` (Task 12 — the FULL `CampaignDraftDetailResponse`; see Task 15's
  Interfaces note on why no step needs its own `+page.server.ts` re-fetch of this same data),
  `formatMoney`/`money` (`@galangdana/money`), `previousStep` (Task 12).
- Produces: the wizard's final step for this sub-phase — a read-only review of everything
  collected. **Deliberately no working "Submit" action**: this plan's own scope (see the
  Goal section at the top of this document) explicitly stops before individual KYC and actual
  campaign submission, both of which are sub-phase 2c's job. Building a submit button here that
  does nothing real would violate this project's "No Placeholders" discipline — instead, this
  page honestly states that final submission is not yet available, rather than faking it.

- [ ] **Step 1: Write the failing test — `apps/web/src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "rangkuman",
  answers: { title: "Bantu Aldi Sembuh", purpose: "Biaya operasi jantung", goalAmountStr: "15000000" },
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("rangkuman step rendering", () => {
  test("shows the collected title, purpose, and formatted goal amount", () => {
    render(Page, {
      props: {
        data: {
          draft: {
            ...DRAFT,
            storyAnswers: [{ questionNumber: 1, answerText: "Sejak dua bulan lalu." }],
            manualStory: null,
            patient: { name: "Aldi", age: 2, illness: "Kelainan jantung", hospitalName: null, relationshipToCampaigner: null },
            beneficiary: null,
            documents: [],
          },
        },
      },
    });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Biaya operasi jantung")).not.toBeNull();
    expect(screen.getByText("Rp15.000.000")).not.toBeNull();
    expect(screen.getByText("Aldi")).not.toBeNull();
    expect(screen.getByText("Sejak dua bulan lalu.")).not.toBeNull();
  });

  test("shows the manual story instead of guided answers when that mode was used", () => {
    render(Page, {
      props: {
        data: {
          draft: {
            ...DRAFT,
            storyAnswers: [],
            manualStory: "Cerita lengkap yang ditulis manual.",
            patient: null,
            beneficiary: null,
            documents: [],
          },
        },
      },
    });
    expect(screen.getByText("Cerita lengkap yang ditulis manual.")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 3: Implement the page — `+page.svelte`** (no `+page.server.ts` needed)

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { formatMoney, money } from "@galangdana/money";
import type { PageProps } from "./$types";
import { previousStep } from "../step-order";

const { data }: PageProps = $props();

const title = $derived(typeof data.draft.answers.title === "string" ? data.draft.answers.title : "");
const purpose = $derived(typeof data.draft.answers.purpose === "string" ? data.draft.answers.purpose : "");
const callToAction = $derived(typeof data.draft.answers.callToAction === "string" ? data.draft.answers.callToAction : "");
const goalAmountStr = $derived(typeof data.draft.answers.goalAmountStr === "string" ? data.draft.answers.goalAmountStr : null);
const formattedGoal = $derived(goalAmountStr ? formatMoney(money(BigInt(goalAmountStr), "IDR")) : null);

async function back() {
  const target = previousStep(data.draft.track, "rangkuman");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Ringkasan Campaign</h2>

  <dl class="mb-6 space-y-4 font-sans text-sm">
    {#if title}
      <div>
        <dt class="font-medium text-neutral-900">Judul</dt>
        <dd class="text-neutral-600">{title}</dd>
      </div>
    {/if}
    {#if purpose}
      <div>
        <dt class="font-medium text-neutral-900">Tujuan</dt>
        <dd class="text-neutral-600">{purpose}</dd>
      </div>
    {/if}
    {#if formattedGoal}
      <div>
        <dt class="font-medium text-neutral-900">Target Donasi</dt>
        <dd class="text-neutral-600">{formattedGoal}</dd>
      </div>
    {/if}
    {#if callToAction}
      <div>
        <dt class="font-medium text-neutral-900">Ajakan</dt>
        <dd class="text-neutral-600">{callToAction}</dd>
      </div>
    {/if}

    <div>
      <dt class="font-medium text-neutral-900">Cerita</dt>
      {#if data.draft.manualStory}
        <dd class="whitespace-pre-line text-neutral-600">{data.draft.manualStory}</dd>
      {:else if data.draft.storyAnswers.length > 0}
        <dd class="space-y-1 text-neutral-600">
          {#each data.draft.storyAnswers.sort((a, b) => a.questionNumber - b.questionNumber) as answer (answer.questionNumber)}
            <p>{answer.answerText}</p>
          {/each}
        </dd>
      {:else}
        <dd class="text-neutral-400">Belum diisi</dd>
      {/if}
    </div>

    {#if data.draft.patient}
      <div>
        <dt class="font-medium text-neutral-900">Pasien</dt>
        <dd class="text-neutral-600">{data.draft.patient.name} — {data.draft.patient.illness}</dd>
      </div>
    {/if}
    {#if data.draft.beneficiary}
      <div>
        <dt class="font-medium text-neutral-900">Penerima Manfaat</dt>
        <dd class="text-neutral-600">{data.draft.beneficiary.name} — {data.draft.beneficiary.needDescription}</dd>
      </div>
    {/if}

    <div>
      <dt class="font-medium text-neutral-900">Dokumen ({data.draft.documents.length})</dt>
      {#if data.draft.documents.length > 0}
        <dd class="text-neutral-600">
          {#each data.draft.documents as doc (doc.id)}
            <p>{doc.type}</p>
          {/each}
        </dd>
      {:else}
        <dd class="text-neutral-400">Belum ada dokumen diunggah</dd>
      {/if}
    </div>
  </dl>

  <p class="mb-6 rounded-sm bg-neutral-100 p-3 font-sans text-sm text-neutral-600">
    Verifikasi identitas dan pengajuan akhir campaign akan tersedia setelah langkah verifikasi
    ditambahkan pada tahap berikutnya.
  </p>

  <button type="button" onclick={back} class="font-sans text-sm text-neutral-600">Kembali</button>
</div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts"`
Expected: PASS — 2 tests.

- [ ] **Step 5: Manually verify the complete wizard flow end to end, one final time**

With `apps/api` and `apps/web` running locally, and a valid session cookie: walk through the
real API sequence this entire plan built — create a draft, save each answer step, save a guided
story, save patient/beneficiary, upload a document, confirm the OTP step, then `GET
/campaign-drafts/:id` and confirm the response contains everything just saved, matching what
`rangkuman`'s page will render via Task 12's layout data. This is the plan's final end-to-end
confidence check — report the full sequence's actual output.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd /home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add rangkuman read-only draft summary step"
```

---

## Verification

- **Unit** (`bun test` across `packages/db`, `apps/api`; `vitest` across `apps/web`): every new
  schema, route, and component has a real test asserting actual behavior against real
  infrastructure (real Postgres, real MinIO presigned uploads) — no mocking, matching every
  earlier phase's established testing philosophy.
- **The two new gotchas this plan's own research found and documented, each with a regression
  note at the exact spot a future edit could reintroduce them**: the `@elysiajs/cors` peer-
  dependency trap (Global Constraints, Task 4), and Eden Treaty's kebab-case route-prefix
  bracket-notation requirement (Global Constraints, every page task from Task 12 onward).
- **Ownership enforcement**: every authenticated `campaign-drafts` endpoint returns 404 (never
  403) for a draft that exists but belongs to someone else — verified by dedicated tests in
  Tasks 6, 7 (and implicitly relied on by Tasks 8–10's identical ownership-check pattern).
- **Security**: the private `campaign-documents` bucket's objectKey is always server-generated,
  never client-supplied (Task 10); the presigned-upload confirm step rejects an objectKey outside
  the requesting draft's own prefix (Task 10); document uploads are restricted to a whitelisted
  extension set (Task 10).
- **Draft/manual story mutual exclusion**: Task 8's guided/manual save logic is tested to
  guarantee a draft never carries both simultaneously, and `rangkuman` (Task 19) correctly
  prefers whichever one is actually present.

## Risks

- **This sub-phase does not create a real `campaigns` row.** `rangkuman` is a read-only summary,
  not a submit action — actual campaign creation (draft → real `campaigns` row with
  `status: "pending_review"`) is sub-phase 2c's job, alongside individual KYC. A draft built
  through this entire wizard is not yet a published or even submitted campaign.
- **RAB (budget) module is entirely out of scope** — sub-phase 2b's job. This plan's wizard
  never asks for a budget breakdown.
- **The `otp` step's reuse of `/auth/otp/verify` creates a redundant session row per use** (see
  Task 18's own scope note) — harmless, but worth knowing if `sessions` table row counts ever
  look higher than expected during testing.
- **No draft-expiry cleanup job exists.** `campaign_drafts.expiresAt` is set on creation (7 days)
  but nothing reads it yet — an abandoned draft simply sits in the table indefinitely. Fine for
  this phase; a real cleanup job is future work.
- **Guided-story question text is original, not verified against any real platform** — only the
  step count (6 medical / 7 non-medical) and the existence of a manual escape hatch were ever
  confirmed from live inspection; the actual question wording in this plan is new copy, matching
  this project's IP boundary (routes/IA are clonable, copy is not).

