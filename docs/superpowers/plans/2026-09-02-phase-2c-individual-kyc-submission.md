# Phase 2c: Individual KYC + Campaign Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a finished `campaign_drafts` row into a real, moderatable `campaigns` row: individual KYC (identity + KTP + selfie) and the actual "submit" action that flips a campaign from `draft` to `pending_review`, closing the gap Phase 2a deliberately left open.

**Architecture:** Reuses every established pattern from Phase 2a verbatim where it fits — presigned-upload-to-MinIO for KYC documents (mirrors Task 10's `campaign-drafts/:id/documents` flow exactly), the SSR-auth wizard-layout shell (mirrors the fixed `create/[draftId]/step/+layout.server.ts`), the simple-field step template, and the ownership-scoped-404 pattern. The only new mechanism is the draft→campaign conversion itself: a `POST /campaigns` endpoint that reads a finished draft, generates a unique non-reserved slug, resolves-or-creates the requesting user's `campaigners` row, and inserts a real `campaigns` row in `status: "draft"` — KYC then operates on that real campaign id (matching the master plan's own route naming, `/kyc/[campaign_id]/...`), and a final `POST /campaigns/:id/submit` flips it to `pending_review` once both KYC documents are on file.

**Tech Stack:** SvelteKit 2 + ElysiaJS (Bun) + Drizzle ORM + Postgres + MinIO (`Bun.S3Client`), same as every prior phase.

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` (the master plan) — this plan implements the "individual KYC" and "actual campaign submission" pieces the master plan lists under Phase 2 ("Creation wizard ... individual KYC, document upload") and explicitly deferred out of Phase 2a's scope (see Phase 2a's Task 19 brief: "actual campaign creation ... is sub-phase 2c's job"). RAB (the budget/`campaign_budget_items` module, sub-phase 2b) is explicitly OUT of scope for this plan — the project owner chose to sequence individual KYC + submission first.

## Global Constraints

- **Money is bigint minor-unit rupiah, never float** (repo-wide constraint since Phase 0a). `campaign_drafts.answers.goalAmountStr` is a decimal STRING — this plan's `POST /campaigns` task is the exact moment it is finally parsed to a real `bigint` via `BigInt(goalAmountStr)`, written into `campaigns.goalAmount`. Never re-introduce a string/number ambiguity anywhere downstream of that parse.
- **`campaigns.draftId` is nullable** (`onDelete: "set null"`) — `campaign_drafts` and its child tables (`campaign_story_answers`, `patients`, `beneficiaries`, `campaign_documents`) remain the permanent source of truth for authored content. `campaigns` gains a pointer back to its origin draft; content is never duplicated into new campaign-scoped tables.
- **Ownership-scoped 404-not-403 pattern, established since Phase 2a and non-negotiable:** every new endpoint that operates on a specific `campaigns.id` must scope its query so a non-owner's request produces the IDENTICAL 404 response as a nonexistent id — never a 403, never any signal that the campaign exists. Ownership here means: the requesting user's own `campaigners` row (resolved via `campaigners.userId`) matches `campaigns.campaignerId`.
- **Eden Treaty kebab-case bracket-notation gotcha, verified repeatedly in Phase 2a:** Eden Treaty does NOT camelCase a kebab-case route prefix. A route mounted at `/campaigns` has no hyphen so plain dot-notation (`api.campaigns(...)`) is fine, but any NEW route segment containing a hyphen (there are none planned in this file, but if one is introduced, treat it the same as Phase 2a's `campaign-drafts`) must use bracket notation.
- **The authenticated cross-origin request pattern** (`createServerApiClient` from `apps/web/src/lib/server-api-client.ts`, `+page.server.ts`/`+layout.server.ts` reading `event.cookies`) applies to every new SSR page in this plan. The new `/kyc/[campaignId]/step/+layout.server.ts` MUST carry forward the `uses.url`-tracking fix discovered during Phase 2a's final review: read a property of the tracked `url` object (e.g. `url.pathname`) **unconditionally, before any conditional branch**, so SvelteKit's dependency tracker re-runs the load on every step navigation. Copy this pattern from the current, already-fixed `apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.server.ts` — do not reintroduce the staleness bug by writing a fresh layout that only reads `url` inside a redirect branch.
- **Presigned document upload, established in Phase 2a Task 10 and verified security-sound (a security-sensitive pattern; do not weaken it):** the objectKey a presigned URL targets is always server-generated, never client-supplied. The confirm step re-derives and checks the client-supplied `objectKey` genuinely starts with the expected server-controlled prefix before trusting it. This plan's KYC document endpoints must follow the identical shape, scoped to `kyc/{campaignId}/{ktp|selfie}/{uuid}.{ext}` instead of `drafts/{draftId}/{type}/{uuid}.{ext}`.
- **Same private MinIO bucket as Phase 2a** (`campaign-documents`, `MEDIA_S3_PRIVATE_BUCKET` env var) — KYC documents (KTP, selfie) are at least as sensitive as evidentiary documents and belong in the same already-private bucket; no new bucket is created by this plan.
- **`bun run lint` clean before every commit** — a repeated, previously-flagged gap; still non-negotiable.
- **This repo is 100% Bun tooling. Never npm/yarn/npx.**
- **`bun` may not be on PATH in a fresh shell**, especially inside an isolated git worktree (a harness-level quirk hit repeatedly in Phase 2a). It is installed at `/home/ubuntu/.bun/bin/bun` (v1.4.0). Either `export PATH="/home/ubuntu/.bun/bin:$PATH"` first, or invoke via the full path. Never fall back to npm/npx/yarn to route around this.
- **If a dispatched implementer's isolated worktree is missing prior commits it should have** (a known, previously-hit harness issue where an isolated worktree occasionally branches from a stale base): fix it with a REAL `git merge <known-good-sha-or-branch>`, never by manually reconstructing/copying files — a manual reconstruction has previously introduced silent contamination (an unauthorized `@ts-ignore`) into an already-reviewed file. Verify success via `git merge-base --is-ancestor <known-good-sha> HEAD`.
- **`apps/web` test-file gotchas, established across Phase 2a's later tasks:**
  - Any test file whose component (transitively) imports `$lib/api-client` needs `vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }))` at the top, or the component's top-level module code throws at import time inside the test runner.
  - Any test exercising a component that calls `goto(...)` (from `$app/navigation`) needs `vi.mock("$app/navigation", () => ({ goto: (...args) => goto(...args) }))` with a `vi.fn()`-backed `goto`, since the real `goto` throws outside a real SvelteKit router context.
  - A dynamic-route page's `render(Page, { props: { data, params, ... } })` call needs a real `params` object matching the route's dynamic segments (e.g. `{ campaignId: "..." }`), or `PageProps`'s generated type will reject the call.
- **No cover-photo collection in this phase.** The wizard never collects a cover image; `campaigns.coverMediaUrl` is left `NULL` when a campaign is created from a draft. This is a known, deliberate gap — see Risks.
- **`campaigners.verifiedAt` stays `NULL` for every campaigner created by this plan.** This plan collects and stores KYC documents; it does NOT implement real third-party identity verification (see the KYC design note in Task 5's brief) — `verifiedAt` is set by a later, out-of-scope admin/verification flow (Phase 3's job), not by anything in this plan.

## Domain Model / Interfaces Summary

New/changed tables (all in `packages/db/src/schema/`):
- `campaigns` (existing, Phase 1) gains: `draftId: uuid (nullable, FK -> campaign_drafts.id, onDelete: set null)`.
- `campaigners` (existing, Phase 1) gains: `userId: uuid (nullable, FK -> users.id, onDelete: cascade, unique)`.
- `individual_verifications` (new): one row per campaign undergoing individual KYC. `campaignId (FK -> campaigns.id, unique, onDelete: cascade)`, `fullName`, `nationalId` (NIK), `dateOfBirth`, `address`, `city`, `postalCode`, `ktpObjectKey (nullable)`, `selfieObjectKey (nullable)`, `consentedAt (nullable timestamp)`, `status` enum (`pending | verified | rejected`, default `pending`), `createdAt`, `updatedAt`.

New API surface (`apps/api/src/routes/campaigns.ts`, extending the existing read-only `campaignsRoute` from Phase 1 — this plan ADDS write endpoints to that same file, it does not create a new route file, since Eden Treaty resolves routes by prefix and `campaigns` already owns the `/campaigns` prefix):
- `POST /campaigns` — body `{ draftId: string }` → creates the real `campaigns` row from a finished draft. Response: `{ id, slug }`.
- `PUT /campaigns/:id/kyc/identity` — body `{ fullName, nationalId, dateOfBirth }`.
- `PUT /campaigns/:id/kyc/contact` — body `{ address, city, postalCode }`.
- `POST /campaigns/:id/kyc/documents/presign` — body `{ documentType: "ktp" | "selfie", fileName }` → `{ uploadUrl, objectKey, expiresInSeconds }`.
- `POST /campaigns/:id/kyc/documents/confirm` — body `{ documentType: "ktp" | "selfie", objectKey }`.
- `GET /campaigns/:id/kyc` — returns the current `individual_verifications` row (or defaults) for the owning user's own campaign, plus the campaign's own `status`/`title`/`slug` — this is what the KYC layout's SSR load and the `summary` page read.
- `POST /campaigns/:id/submit` — validates both `ktpObjectKey` and `selfieObjectKey` are present, flips `campaigns.status` from `"draft"` to `"pending_review"`. Idempotent-ish: re-calling after a successful submit returns the same success shape without erroring (the campaign is already `pending_review`; this endpoint does not error on that case, since a user may legitimately land on `/kyc/[campaignId]/pending` more than once).

New web surface (`apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/`), mirroring `create/[draftId]/step/`'s shape exactly:
- `+layout.server.ts` / `+layout.svelte` — SSR auth + ownership + a small step progress indicator (3 steps: identity, contact, consent — document upload and the hold/pending/summary pages are outside the numbered step sequence, matching the master plan's own route list where `upload-id`/`upload-selfie`/`hold`/`pending`/`summary` are siblings of `step-1..3`, not folded into them).
- `step-1/+page.svelte` (identity), `step-2/+page.svelte` (contact), `step-3/+page.svelte` (consent).
- `upload-id/+page.svelte`, `upload-selfie/+page.svelte` — actually **one page** handling both (see Task 13 — the master plan's route names are kept as the two logical steps a user moves through, implemented as a single component instance reused for both via a route param, to avoid duplicating the presign/upload/confirm logic twice for what is otherwise identical code).
- `hold/+page.svelte`, `pending/+page.svelte`, `summary/+page.svelte`.

---

## Task 1: Schema — `campaigns.draftId`, `campaigners.userId`, `individual_verifications`

**Files:**
- Modify: `packages/db/src/schema/campaigns.ts`
- Modify: `packages/db/src/schema/campaigners.ts`
- Create: `packages/db/src/schema/individual-verifications.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/individual-verifications.test.ts`

**Interfaces:**
- Consumes: `campaigns` (Phase 1), `campaigners` (Phase 1), `campaign_drafts` (Phase 2a), `users` (Phase 0a).
- Produces: `campaigns.draftId`, `campaigners.userId`, the `individualVerifications` table + `individualVerificationStatusEnum`, consumed by every later task in this plan.

- [ ] **Step 1: Write the failing test — `packages/db/src/__tests__/individual-verifications.test.ts`**

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignDrafts } from "../schema/campaign-drafts";
import { individualVerifications } from "../schema/individual-verifications";
import { users } from "../schema/users";

describe("individual_verifications", () => {
  let categoryId: number;

  beforeAll(async () => {
    const [category] = await db
      .select({ id: campaignCategories.id })
      .from(campaignCategories)
      .limit(1);
    if (!category) throw new Error("expected seeded categories for this test");
    categoryId = category.id;
  });

  test("stores identity + contact + document keys for a campaign, one row per campaign", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62812${Date.now()}` })
      .returning();
    if (!user) throw new Error("user insert failed");

    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: user.id,
        track: "medical",
        categoryId,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");

    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test Campaigner", userId: user.id })
      .returning();
    if (!campaigner) throw new Error("campaigner insert failed");

    const [campaign] = await db
      .insert(campaigns)
      .values({
        slug: `test-campaign-${Date.now()}`,
        title: "Bantu Aldi Sembuh",
        shortDescription: "Biaya operasi jantung",
        categoryId,
        campaignerId: campaigner.id,
        model: "goal",
        goalAmount: 15000000n,
        draftId: draft.id,
      })
      .returning();
    if (!campaign) throw new Error("campaign insert failed");

    const [verification] = await db
      .insert(individualVerifications)
      .values({
        campaignId: campaign.id,
        fullName: "Aldi Setiawan",
        nationalId: "3271234567890001",
        dateOfBirth: "1990-05-12",
        address: "Jl. Merdeka No. 1",
        city: "Bandung",
        postalCode: "40111",
      })
      .returning();
    if (!verification) throw new Error("verification insert failed");

    expect(verification.status).toBe("pending");
    expect(verification.ktpObjectKey).toBeNull();
    expect(verification.selfieObjectKey).toBeNull();

    const [fetched] = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(fetched?.fullName).toBe("Aldi Setiawan");

    // unique(campaignId): a second insert for the same campaign conflicts
    await expect(
      Promise.resolve(
        db.insert(individualVerifications).values({
          campaignId: campaign.id,
          fullName: "Duplicate Attempt",
          nationalId: "0000000000000000",
          dateOfBirth: "2000-01-01",
          address: "x",
          city: "x",
          postalCode: "00000",
        }),
      ),
    ).rejects.toThrow();
  });

  test("campaigns.draftId links back to its originating draft and survives draft deletion as NULL", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62813${Date.now()}` })
      .returning();
    if (!user) throw new Error("user insert failed");

    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: user.id,
        track: "non_medical",
        categoryId,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");

    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Another Campaigner", userId: user.id })
      .returning();
    if (!campaigner) throw new Error("campaigner insert failed");

    const [campaign] = await db
      .insert(campaigns)
      .values({
        slug: `linked-campaign-${Date.now()}`,
        title: "Renovasi Musala",
        shortDescription: "Bantu renovasi musala desa",
        categoryId,
        campaignerId: campaigner.id,
        model: "goal",
        goalAmount: 5000000n,
        draftId: draft.id,
      })
      .returning();
    if (!campaign) throw new Error("campaign insert failed");

    expect(campaign.draftId).toBe(draft.id);

    await db.delete(campaignDrafts).where(eq(campaignDrafts.id, draft.id));

    const [afterDelete] = await db
      .select({ draftId: campaigns.draftId })
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id));
    expect(afterDelete?.draftId).toBeNull();
  });

  test("campaigners.userId is unique per user", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62814${Date.now()}` })
      .returning();
    if (!user) throw new Error("user insert failed");

    await db.insert(campaigners).values({ type: "individual", displayName: "First", userId: user.id });

    await expect(
      Promise.resolve(
        db.insert(campaigners).values({ type: "individual", displayName: "Second", userId: user.id }),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/individual-verifications.test.ts`
Expected: FAIL — `individualVerifications` doesn't exist, `campaigns.draftId`/`campaigners.userId` don't exist.

- [ ] **Step 3: Add `draftId` to `campaigns` — modify `packages/db/src/schema/campaigns.ts`**

Add the import and column (place near the other FK columns, after `campaignerId`):

```ts
import { campaignDrafts } from "./campaign-drafts";
```

```ts
    // Nullable pointer back to the draft this campaign was submitted from.
    // campaign_drafts (and its child tables: story answers, patient/
    // beneficiary, documents) remain the permanent source of truth for
    // authored content -- this column is a pointer, not a duplication.
    // set null on delete: losing the scratch draft after submission is
    // fine and expected (drafts have a 7-day TTL); the campaign itself
    // must survive.
    draftId: uuid("draft_id").references(() => campaignDrafts.id, { onDelete: "set null" }),
```

- [ ] **Step 4: Add `userId` to `campaigners` — modify `packages/db/src/schema/campaigners.ts`**

Add the import and column, and update the file's own top comment (it currently says auth linkage is "Phase 5's job" -- that's stale, correct it):

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

// Enough to attribute a campaign to someone and support the explore page's
// Kitabisa/Yayasan/Publik-style type filter, plus (as of sub-phase 2c) a
// real link back to the authenticated user who owns this campaigner
// identity. Organization/yayasan onboarding (NPWP, notarial deed, officer
// verification) remains out of scope here -- userId is populated only for
// individual-track campaigners created via the wizard's KYC step.
export const campaignerTypeEnum = pgEnum("campaigner_type", ["individual", "yayasan", "platform"]);

export const campaigners = pgTable("campaigners", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: campaignerTypeEnum("type").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Campaigner = typeof campaigners.$inferSelect;
export type NewCampaigner = typeof campaigners.$inferInsert;
```

- [ ] **Step 5: Create `packages/db/src/schema/individual-verifications.ts`**

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";

// Individual KYC record for a campaign, one row per campaign (unique
// campaignId). The vendor for real KTP/passport-against-official-database
// verification is UNVERIFIED (the master plan's own research never
// identified one -- "third party" with no name or docs). Matching this
// project's established pattern for every undocumented vendor (Sumopod,
// kirim.dev): this table records what a real integration would need
// (identity fields + document keys) but performs no real third-party call.
// `status` starts and stays "pending" until a human reviews it -- that
// review UI is Phase 3's job, not this plan's.
export const individualVerificationStatusEnum = pgEnum("individual_verification_status", [
  "pending",
  "verified",
  "rejected",
]);

export const individualVerifications = pgTable("individual_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .unique()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  nationalId: text("national_id").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  postalCode: text("postal_code").notNull(),
  ktpObjectKey: text("ktp_object_key"),
  selfieObjectKey: text("selfie_object_key"),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  status: individualVerificationStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IndividualVerification = typeof individualVerifications.$inferSelect;
export type NewIndividualVerification = typeof individualVerifications.$inferInsert;
```

- [ ] **Step 6: Wire the barrel export — modify `packages/db/src/schema/index.ts`**

Add: `export * from "./individual-verifications";` (alongside the existing exports; `campaigns.ts`/`campaigners.ts` are already exported, no new line needed for those two since only their *contents* changed).

- [ ] **Step 7: Generate the migration**

Run: `cd packages/db && bun run db:generate` (equivalently `bunx drizzle-kit generate` from that package — check `packages/db/package.json`'s actual script name and use it).
Expected: a new `NNNN_<name>.sql` file appears in `packages/db/drizzle/`, containing `ALTER TABLE "campaigns" ADD COLUMN "draft_id" uuid;`, `ALTER TABLE "campaigners" ADD COLUMN "user_id" uuid;`, `CREATE TYPE "public"."individual_verification_status" AS ENUM(...)`, `CREATE TABLE "individual_verifications" (...)`, plus the two new foreign key constraints and the two new unique constraints. Read the generated SQL to confirm it matches this intent before proceeding — never hand-write migration SQL.

- [ ] **Step 8: Apply the migration and run the test**

Run: `cd packages/db && bun run db:migrate` (check the actual script name in `package.json`), then `bun test src/__tests__/individual-verifications.test.ts`.
Expected: PASS — 3 tests.

- [ ] **Step 9: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add packages/db
git commit -m "feat(db): add campaigns.draftId, campaigners.userId, individual_verifications"
```

---

## Task 2: Contracts — KYC + campaign-creation schemas

**Files:**
- Modify: `packages/contracts/src/campaigns.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `individualVerifications` (Task 1).
- Produces: schemas consumed by every API/web task in this plan.

- [ ] **Step 1: Add the schemas — modify `packages/contracts/src/campaigns.ts`**

Append (do not touch the existing read-only campaign schemas already in this file from Phase 1):

```ts
export const CreateCampaignFromDraftBodySchema = Type.Object({
  draftId: Type.String({ format: "uuid" }),
});

export const CreateCampaignFromDraftResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
});

export const CampaignErrorSchema2c = Type.Object({ error: Type.String() });

export const SaveKycIdentityBodySchema = Type.Object({
  fullName: Type.String({ minLength: 1 }),
  nationalId: Type.String({ minLength: 16, maxLength: 16 }),
  dateOfBirth: Type.String({ minLength: 1 }),
});

export const SaveKycContactBodySchema = Type.Object({
  address: Type.String({ minLength: 1 }),
  city: Type.String({ minLength: 1 }),
  postalCode: Type.String({ minLength: 1 }),
});

export const KycDocumentTypeSchema = Type.Union([Type.Literal("ktp"), Type.Literal("selfie")]);

export const PresignKycDocumentBodySchema = Type.Object({
  documentType: KycDocumentTypeSchema,
  fileName: Type.String({ minLength: 1 }),
});

export const PresignKycDocumentResponseSchema = Type.Object({
  uploadUrl: Type.String(),
  objectKey: Type.String(),
  expiresInSeconds: Type.Number(),
});

export const ConfirmKycDocumentBodySchema = Type.Object({
  documentType: KycDocumentTypeSchema,
  objectKey: Type.String({ minLength: 1 }),
});

export const KycStatusSchema = Type.Object({
  campaignId: Type.String({ format: "uuid" }),
  campaignTitle: Type.String(),
  campaignSlug: Type.String(),
  campaignStatus: Type.String(),
  fullName: Type.Union([Type.String(), Type.Null()]),
  nationalId: Type.Union([Type.String(), Type.Null()]),
  dateOfBirth: Type.Union([Type.String(), Type.Null()]),
  address: Type.Union([Type.String(), Type.Null()]),
  city: Type.Union([Type.String(), Type.Null()]),
  postalCode: Type.Union([Type.String(), Type.Null()]),
  ktpObjectKey: Type.Union([Type.String(), Type.Null()]),
  selfieObjectKey: Type.Union([Type.String(), Type.Null()]),
  consentedAt: Type.Union([Type.String(), Type.Null()]),
});
export type KycStatusResponse = Static<typeof KycStatusSchema>;

export const SubmitCampaignResponseSchema = Type.Object({
  status: Type.String(),
});
```

Check the top of `packages/contracts/src/campaigns.ts` already imports `{ type Static, Type } from "@sinclair/typebox"` — if `Static` isn't already imported, add it.

- [ ] **Step 2: Wire the barrel export — modify `packages/contracts/src/index.ts`**

Add to the existing `campaigns.ts` export block (find the existing `export { CampaignCategorySchema, ... } from "./campaigns";` block and extend it in place, alphabetically, matching this file's existing convention):

```ts
  CampaignErrorSchema2c,
  ConfirmKycDocumentBodySchema,
  CreateCampaignFromDraftBodySchema,
  CreateCampaignFromDraftResponseSchema,
  KycDocumentTypeSchema,
  KycStatusSchema,
  PresignKycDocumentBodySchema,
  PresignKycDocumentResponseSchema,
  SaveKycContactBodySchema,
  SaveKycIdentityBodySchema,
  SubmitCampaignResponseSchema,
```

and to the existing `export type { ... } from "./campaigns";` block:

```ts
  KycStatusResponse,
```

- [ ] **Step 3: Run lint, typecheck**

Run: `bun run lint && bun run typecheck` from the worktree root.
Expected: clean (this task has no tests of its own — schemas are exercised by Task 4-8's real endpoint tests).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add campaign-creation and individual-KYC schemas"
```

---

## Task 3: Reserved slugs + slug generation

**Files:**
- Create: `apps/api/src/lib/slug.ts`
- Test: `apps/api/src/lib/slug.test.ts`

**Interfaces:**
- Consumes: `campaigns` (Task 1's `db` client, read for uniqueness checks).
- Produces: `generateUniqueSlug(title: string): Promise<string>`, consumed by Task 5.

This project's cross-cutting concern, quoted verbatim from the master plan: *"Reserved slugs. Kitabisa's own /campaign/create resolves to a user campaign — they don't reserve route-colliding slugs. We keep a reserved list and validate at creation."* The reserved list below is compiled from every top-level route segment named anywhere in the master plan's Module Map (not just what's implemented so far), since a slug generated today must not collide with a route this project builds in a LATER phase either.

- [ ] **Step 1: Write the failing test — `apps/api/src/lib/slug.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { db } from "@galangdana/db";
import { campaignCategories, campaigners, campaigns } from "@galangdana/db";
import { generateUniqueSlug, RESERVED_SLUGS } from "./slug";

describe("generateUniqueSlug", () => {
  test("slugifies a title into a URL-safe, lowercase, hyphenated form", async () => {
    const slug = await generateUniqueSlug("Bantu Aldi Sembuh dari Kelainan Jantung!");
    expect(slug).toBe("bantu-aldi-sembuh-dari-kelainan-jantung");
  });

  test("appends a numeric suffix when the base slug is already taken", async () => {
    const [category] = await db.select({ id: campaignCategories.id }).from(campaignCategories).limit(1);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/slug.test.ts`
Expected: FAIL — `./slug` doesn't exist.

- [ ] **Step 3: Implement `apps/api/src/lib/slug.ts`**

```ts
import { campaigns, db } from "@galangdana/db";
import { eq } from "drizzle-orm";

// Every top-level route segment named anywhere in the master plan's Module
// Map, not just what's implemented so far -- a slug generated today must
// not collide with a route a LATER phase builds either. Kept as a flat,
// append-only set rather than trying to derive it from the live route
// tree, since most of these routes don't exist in the codebase yet.
export const RESERVED_SLUGS = new Set([
  "explore",
  "category",
  "search",
  "lihatsemua",
  "product",
  "initiative",
  "campaign",
  "contribute",
  "donation",
  "create",
  "dashboard",
  "kyc",
  "verification",
  "donasi-otomatis",
  "zakat",
  "user",
  "setting",
  "inbox",
  "doa-orang-baik",
  "orang-baik",
  "apps",
  "org",
  "help",
  "admin",
  "about-us",
  "login",
  "register",
  "healthz",
  "_offline",
  "contact",
]);

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Generates a URL-safe slug from a campaign title, guaranteed unique
 * against both this project's reserved route segments and every existing
 * campaigns.slug row. Appends "-2", "-3", ... on collision.
 */
export async function generateUniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "campaign";
  let candidate = base;
  let suffix = 1;

  while (true) {
    const reserved = RESERVED_SLUGS.has(candidate);
    const existing = reserved
      ? [{ slug: candidate }]
      : await db.select({ slug: campaigns.slug }).from(campaigns).where(eq(campaigns.slug, candidate));

    if (existing.length === 0) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/slug.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/slug.ts apps/api/src/lib/slug.test.ts
git commit -m "feat(api): add reserved-slug list and unique slug generation"
```

---

## Task 4: Campaigner linkage helper

**Files:**
- Create: `apps/api/src/lib/campaigner.ts`
- Test: `apps/api/src/lib/campaigner.test.ts`

**Interfaces:**
- Consumes: `campaigners`, `users` (Task 1's schema, `db` client).
- Produces: `getOrCreateCampaignerForUser(userId: string): Promise<Campaigner>`, consumed by Task 5.

- [ ] **Step 1: Write the failing test — `apps/api/src/lib/campaigner.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/campaigner.test.ts`
Expected: FAIL — `./campaigner` doesn't exist.

- [ ] **Step 3: Implement `apps/api/src/lib/campaigner.ts`**

```ts
import { type Campaigner, campaigners, db, users } from "@galangdana/db";
import { eq } from "drizzle-orm";

/**
 * Resolves the requesting user's own `campaigners` row, creating one
 * (type: "individual") on first use. This is intentionally the simplest
 * viable auth linkage -- no separate "become a campaigner" flow, no
 * organization onboarding (that's a distinct, out-of-scope track).
 */
export async function getOrCreateCampaignerForUser(userId: string): Promise<Campaigner> {
  const [existing] = await db.select().from(campaigners).where(eq(campaigners.userId, userId));
  if (existing) return existing;

  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));

  const [created] = await db
    .insert(campaigners)
    .values({
      type: "individual",
      displayName: user?.name ?? "Penggalang Dana",
      userId,
    })
    .returning();
  if (!created) throw new Error("campaigner creation failed");
  return created;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/campaigner.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/campaigner.ts apps/api/src/lib/campaigner.test.ts
git commit -m "feat(api): add campaigner auth-linkage helper"
```

---

## Task 5: `POST /campaigns` — create a real campaign from a finished draft

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `campaignDrafts`, `campaignStoryAnswers` (Phase 2a), `generateUniqueSlug` (Task 3), `getOrCreateCampaignerForUser` (Task 4), `sessionDerive` (Phase 2a), `CreateCampaignFromDraftBodySchema`/`CreateCampaignFromDraftResponseSchema`/`CampaignErrorSchema2c` (Task 2).
- Produces: the endpoint the `rangkuman` step's real submit button (Task 10) calls.

This is the draft→campaign conversion. Read `apps/api/src/routes/campaigns.ts` as it currently exists (Phase 1's read-only `campaignsRoute`) before editing — this task ADDS a `.post("/", ...)` handler to that same Elysia instance; it does not create a new route file.

**Field mapping (draft → campaign), the core of this task:**
- `title` ← `draft.answers.title` (string; if missing/not a string, this is a client error — the wizard shouldn't allow reaching `rangkuman`'s submit action without it, but the API must not trust that and should 400 rather than insert `NULL` into a NOT NULL column)
- `shortDescription` ← `draft.answers.purpose` (same missing-value handling as above)
- `story` ← if the draft has `campaignStoryAnswers` rows, join their `answerText` (sorted by `questionNumber`) with `"\n\n"`; else if `draft.answers.story` is a string, use it verbatim; else `""` (matches `campaigns.story`'s existing `.default("")`, though in practice `rangkuman` should never let a user reach submission with neither)
- `goalAmount` ← `BigInt(draft.answers.goalAmountStr)` if it's a non-empty string; else 400
- `model` ← `"goal"` (always, for this plan's scope)
- `categoryId` ← `draft.categoryId` (400 if null — a draft must have a category to become a real campaign)
- `campaignerId` ← `(await getOrCreateCampaignerForUser(user.id)).id`
- `type` ← `"donation"`
- `currency` ← `"IDR"`
- `slug` ← `await generateUniqueSlug(title)`
- `draftId` ← `draft.id`
- `status` ← left at the column's own default (`"draft"` — do NOT explicitly pass `"pending_review"` here; submission is a separate, later action, Task 8)

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/campaigns.test.ts`**

```ts
describe("POST /campaigns", () => {
  test("creates a real campaign from a finished draft, in status 'draft'", async () => {
    const createDraftResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const draft = (await createDraftResp.json()) as { id: string };

    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${draft.id}/answers`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: "rangkuman",
          answers: {
            title: "Bantu Aldi Sembuh",
            purpose: "Biaya operasi jantung",
            goalAmountStr: "15000000",
          },
        }),
      }),
    );
    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${draft.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "manual", text: "Cerita lengkap Aldi." }),
      }),
    );

    const resp = await app.handle(
      authedRequest("http://localhost/campaigns", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; slug: string };
    expect(body.slug).toContain("bantu-aldi-sembuh");

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, body.id));
    expect(row?.status).toBe("draft");
    expect(row?.title).toBe("Bantu Aldi Sembuh");
    expect(row?.goalAmount).toBe(15000000n);
    expect(row?.story).toBe("Cerita lengkap Aldi.");
    expect(row?.draftId).toBe(draft.id);
  });

  test("requires authentication", async () => {
    const resp = await app.handle(
      new Request("http://localhost/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: "11111111-1111-1111-1111-111111111111" }),
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("404s (not 403) when creating from someone else's draft", async () => {
    const createDraftResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const draft = (await createDraftResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest("http://localhost/campaigns", OTHER_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      }),
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_not_found");
  });

  test("400s when the draft is missing required fields", async () => {
    const createDraftResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const draft = (await createDraftResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest("http://localhost/campaigns", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      }),
    );
    expect(resp.status).toBe(400);
  });
});
```

Read the top of `apps/api/src/routes/campaigns.test.ts` first to find (and reuse) its existing `TEST_TOKEN`/`OTHER_TOKEN`/`authedRequest`/`categoryId` setup and its `campaigns`/`eq`/`db` imports — this task's tests must slot into that file's existing patterns, not reinvent them. If `OTHER_TOKEN` doesn't already exist in this file (it may only exist in `campaign-drafts.test.ts`), add the same second-user setup this file's sibling already established — check `campaign-drafts.test.ts`'s own `OTHER_TOKEN` setup and mirror it exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: FAIL — the route doesn't exist yet.

- [ ] **Step 3: Implement the endpoint — modify `apps/api/src/routes/campaigns.ts`**

Add the imports this task needs to the top of the file (alongside whatever's already imported):

```ts
import {
  CampaignErrorSchema2c,
  CreateCampaignFromDraftBodySchema,
  CreateCampaignFromDraftResponseSchema,
} from "@galangdana/contracts";
import { campaignDrafts, campaignStoryAnswers } from "@galangdana/db";
import { getOrCreateCampaignerForUser } from "../lib/campaigner";
import { generateUniqueSlug } from "../lib/slug";
import { sessionDerive } from "../lib/session";
```

Add `.use(sessionDerive)` to the route chain if it isn't already there (check first — Phase 1's read-only `campaignsRoute` likely has no auth at all yet, since every existing endpoint on it is public). Add the new handler:

```ts
  .post(
    "/",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }

      const [draft] = await db
        .select()
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, body.draftId), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const title = typeof draft.answers.title === "string" ? draft.answers.title : null;
      const shortDescription = typeof draft.answers.purpose === "string" ? draft.answers.purpose : null;
      const goalAmountStr =
        typeof draft.answers.goalAmountStr === "string" ? draft.answers.goalAmountStr : null;
      if (!title || !shortDescription || !goalAmountStr || !draft.categoryId) {
        set.status = 400;
        return { error: "draft_incomplete" };
      }

      const storyAnswers = await db
        .select({ questionNumber: campaignStoryAnswers.questionNumber, answerText: campaignStoryAnswers.answerText })
        .from(campaignStoryAnswers)
        .where(eq(campaignStoryAnswers.draftId, draft.id));
      const story =
        storyAnswers.length > 0
          ? storyAnswers
              .sort((a, b) => a.questionNumber - b.questionNumber)
              .map((a) => a.answerText)
              .join("\n\n")
          : typeof draft.answers.story === "string"
            ? draft.answers.story
            : "";

      const campaigner = await getOrCreateCampaignerForUser(user.id);
      const slug = await generateUniqueSlug(title);

      const [campaign] = await db
        .insert(campaigns)
        .values({
          slug,
          title,
          shortDescription,
          story,
          categoryId: draft.categoryId,
          campaignerId: campaigner.id,
          type: "donation",
          currency: "IDR",
          model: "goal",
          goalAmount: BigInt(goalAmountStr),
          draftId: draft.id,
        })
        .returning();
      if (!campaign) {
        set.status = 500;
        return { error: "campaign_creation_failed" };
      }

      return { id: campaign.id, slug: campaign.slug };
    },
    {
      body: CreateCampaignFromDraftBodySchema,
      response: {
        200: CreateCampaignFromDraftResponseSchema,
        400: CampaignErrorSchema2c,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
        500: CampaignErrorSchema2c,
      },
    },
  )
```

Check whether `and`/`eq` are already imported from `drizzle-orm` at the top of this file (Phase 1's read-only queries likely already import `eq`; add `and` if missing) and whether `campaigns`/`db` are already imported from `@galangdana/db` (they should be, from Phase 1).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: PASS — 4 new tests, plus every pre-existing test in this file still passing.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add POST /campaigns (create a real campaign from a finished draft)"
```

---

## Task 6: `PUT /campaigns/:id/kyc/identity` + `PUT /campaigns/:id/kyc/contact`

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `individualVerifications` (Task 1), `SaveKycIdentityBodySchema`/`SaveKycContactBodySchema` (Task 2), `campaigners` (for ownership resolution).
- Produces: the endpoints the KYC step-1/step-2 wizard pages (Task 12) save through.

**Ownership resolution for every KYC endpoint from here on:** a campaign is "owned" by the requesting user when `campaigns.campaignerId` matches `(SELECT id FROM campaigners WHERE user_id = <requesting user's id>)`. Every task from here on scopes its query this way — write a small shared helper in this same file (not a separate module; it's tightly coupled to this route's queries) since every remaining handler in this file needs it:

```ts
async function findOwnedCampaign(campaignId: string, userId: string) {
  const [campaigner] = await db.select({ id: campaigners.id }).from(campaigners).where(eq(campaigners.userId, userId));
  if (!campaigner) return null;
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.campaignerId, campaigner.id)));
  return campaign ?? null;
}
```

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/campaigns.test.ts`**

Add a helper at the top of the new `describe` blocks (or reuse if this file already has one) to create a real campaign for these tests to operate on — extract the "create draft, fill it in, POST /campaigns" sequence from Task 5's own test into a small local helper function `createTestCampaign(token: string)` if convenient, since Tasks 6-8's tests all need one. If you do this, make sure Task 5's own tests still read cleanly (refactor them to use the helper too, or leave them as-is — your call, but don't leave duplicated setup logic sprawling across 4 describe blocks without at least considering it).

```ts
describe("PUT /campaigns/:id/kyc/identity", () => {
  test("saves identity fields for the owning user's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Aldi Setiawan",
          nationalId: "3271234567890001",
          dateOfBirth: "1990-05-12",
        }),
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(individualVerifications).where(eq(individualVerifications.campaignId, campaign.id));
    expect(row?.fullName).toBe("Aldi Setiawan");
  });

  test("re-saving overwrites rather than duplicating (upsert on unique campaignId)", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: "First Name", nationalId: "1111111111111111", dateOfBirth: "1990-01-01" }),
      }),
    );
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: "Revised Name", nationalId: "2222222222222222", dateOfBirth: "1991-02-02" }),
      }),
    );

    const rows = await db.select().from(individualVerifications).where(eq(individualVerifications.campaignId, campaign.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.fullName).toBe("Revised Name");
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, OTHER_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: "x", nationalId: "1111111111111111", dateOfBirth: "1990-01-01" }),
      }),
    );
    expect(resp.status).toBe(404);
  });
});

describe("PUT /campaigns/:id/kyc/contact", () => {
  test("saves contact fields for the owning user's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/contact`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: "Jl. Merdeka No. 1", city: "Bandung", postalCode: "40111" }),
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(individualVerifications).where(eq(individualVerifications.campaignId, campaign.id));
    expect(row?.city).toBe("Bandung");
  });

  test("identity then contact populate the same row, not two rows", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: "Aldi Setiawan", nationalId: "3271234567890001", dateOfBirth: "1990-05-12" }),
      }),
    );
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/contact`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: "Jl. Merdeka No. 1", city: "Bandung", postalCode: "40111" }),
      }),
    );

    const rows = await db.select().from(individualVerifications).where(eq(individualVerifications.campaignId, campaign.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.fullName).toBe("Aldi Setiawan");
    expect(rows[0]?.city).toBe("Bandung");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: FAIL — the two routes don't exist.

- [ ] **Step 3: Implement both endpoints — modify `apps/api/src/routes/campaigns.ts`**

Add to the imports: `individualVerifications` from `@galangdana/db`, `SaveKycIdentityBodySchema`/`SaveKycContactBodySchema` from `@galangdana/contracts`. Add the `findOwnedCampaign` helper from this task's own header above, once, near the top of the file (after imports, before the route chain). Chain both handlers onto the existing `campaignsRoute`:

```ts
  .put(
    "/:id/kyc/identity",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      await db
        .insert(individualVerifications)
        .values({
          campaignId: campaign.id,
          fullName: body.fullName,
          nationalId: body.nationalId,
          dateOfBirth: body.dateOfBirth,
          address: "",
          city: "",
          postalCode: "",
        })
        .onConflictDoUpdate({
          target: individualVerifications.campaignId,
          set: { fullName: body.fullName, nationalId: body.nationalId, dateOfBirth: body.dateOfBirth, updatedAt: new Date() },
        });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveKycIdentityBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
      },
    },
  )
  .put(
    "/:id/kyc/contact",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      await db
        .insert(individualVerifications)
        .values({
          campaignId: campaign.id,
          fullName: "",
          nationalId: "",
          dateOfBirth: "",
          address: body.address,
          city: body.city,
          postalCode: body.postalCode,
        })
        .onConflictDoUpdate({
          target: individualVerifications.campaignId,
          set: { address: body.address, city: body.city, postalCode: body.postalCode, updatedAt: new Date() },
        });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveKycContactBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
      },
    },
  )
```

Note the `.insert(...).values({...all NOT NULL columns with placeholder empty strings for the ones this specific endpoint doesn't own...}).onConflictDoUpdate({ set: {only the fields this endpoint owns} })` shape — this is necessary because `individual_verifications.fullName`/`nationalId`/`dateOfBirth`/`address`/`city`/`postalCode` are all `NOT NULL` (a real verification record needs all of them eventually, but a user fills them in across two separate steps), so the FIRST insert for a brand-new campaign (whichever of identity/contact the user reaches first) must supply *something* for every NOT NULL column, then the SECOND call's `onConflictDoUpdate` fills in the columns it actually owns without touching the other step's already-saved values. Verify this reasoning by re-reading the test above ("identity then contact populate the same row") once you've implemented it — if this doesn't work as described, you have found a genuine plan defect; investigate and fix the schema/endpoint design directly rather than silently working around it (e.g., consider whether these 6 columns should actually be nullable at the DB level with a separate application-level completeness check at submission time — Task 8's `POST /:id/submit` already needs to check "is the record complete" for `ktpObjectKey`/`selfieObjectKey`, so extending that same completeness check to the 6 identity/contact fields there instead of enforcing them via NOT NULL is a legitimate, better alternative if the placeholder-empty-string approach feels as wrong to you as it might; if you make this change, it's a deviation from Task 1's schema — go back and amend Task 1's migration in a new follow-up migration rather than trying to edit an already-applied one, and note this clearly in your report).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: PASS — 5 new tests.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add PUT /campaigns/:id/kyc/identity and /contact"
```

---

## Task 7: KYC document presign + confirm

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `individualVerifications` (Task 1), `PresignKycDocumentBodySchema`/`PresignKycDocumentResponseSchema`/`ConfirmKycDocumentBodySchema` (Task 2), `findOwnedCampaign` (Task 6).
- Produces: the endpoints the KYC document-upload page (Task 13) uses.

This mirrors Phase 2a Task 10's `campaign-drafts/:id/documents/presign` + `/documents` pattern almost exactly — same security-sensitive design (server-generated objectKey, confirm re-validates the prefix), scoped to `kyc/{campaignId}/{ktp|selfie}/{uuid}.{ext}` instead of `drafts/{draftId}/{type}/{uuid}.{ext}`, writing into `individual_verifications.ktpObjectKey`/`selfieObjectKey` instead of a new `campaign_documents` row.

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/campaigns.test.ts`**

```ts
describe("POST /campaigns/:id/kyc/documents/presign + /confirm", () => {
  test("returns a presigned PUT URL scoped under kyc/{campaignId}/{documentType}/", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/presign`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "ktp", fileName: "ktp.jpg" }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { uploadUrl: string; objectKey: string };
    expect(body.objectKey.startsWith(`kyc/${campaign.id}/ktp/`)).toBe(true);
    expect(body.objectKey.endsWith(".jpg")).toBe(true);
  });

  test("records the document after a real presigned upload round-trip, for both ktp and selfie", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    for (const documentType of ["ktp", "selfie"] as const) {
      const presignResp = await app.handle(
        authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/presign`, TEST_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType, fileName: `${documentType}.jpg` }),
        }),
      );
      const { uploadUrl, objectKey } = (await presignResp.json()) as { uploadUrl: string; objectKey: string };

      const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake image bytes" });
      expect(putResp.status).toBe(200);

      const confirmResp = await app.handle(
        authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/confirm`, TEST_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType, objectKey }),
        }),
      );
      expect(confirmResp.status).toBe(200);
    }

    const [row] = await db.select().from(individualVerifications).where(eq(individualVerifications.campaignId, campaign.id));
    expect(row?.ktpObjectKey).not.toBeNull();
    expect(row?.selfieObjectKey).not.toBeNull();
  });

  test("rejects confirming an objectKey outside this campaign's own kyc prefix", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentType: "ktp",
          objectKey: "kyc/00000000-0000-0000-0000-000000000000/ktp/hijack.jpg",
        }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("404s (not 403) for a non-owner's campaign on both presign and confirm", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const presignResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/presign`, OTHER_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "ktp", fileName: "ktp.jpg" }),
      }),
    );
    expect(presignResp.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: FAIL — the two routes don't exist.

- [ ] **Step 3: Implement both endpoints — modify `apps/api/src/routes/campaigns.ts`**

Add near the top of the file, alongside the existing imports (this file needs its OWN `Bun.S3Client` instance and extension allowlist — do not import `apps/api/src/routes/campaign-drafts.ts`'s, since route files in this codebase don't share module-level state across files; duplicate the small config, matching the established pattern of each route file owning its own S3 client):

```ts
const ALLOWED_KYC_EXTENSIONS = ["jpg", "jpeg", "png"];

const kycDocumentsS3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "galangdana",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "galangdana-dev-secret",
  bucket: process.env.MEDIA_S3_PRIVATE_BUCKET ?? "campaign-documents",
  region: "us-east-1",
});

function extractKycExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ALLOWED_KYC_EXTENSIONS.includes(ext) ? ext : null;
}
```

(Note: KYC photos are always images — jpg/jpeg/png, deliberately no `pdf` here, unlike the evidentiary-document upload's allowlist, since a KTP/selfie photo is never a PDF.)

Add the two handlers:

```ts
  .post(
    "/:id/kyc/documents/presign",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const ext = extractKycExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }

      const objectKey = `kyc/${params.id}/${body.documentType}/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = kycDocumentsS3.file(objectKey).presign({ method: "PUT", expiresIn: expiresInSeconds });

      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String() }),
      body: PresignKycDocumentBodySchema,
      response: {
        200: PresignKycDocumentResponseSchema,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
        422: CampaignErrorSchema2c,
      },
    },
  )
  .post(
    "/:id/kyc/documents/confirm",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      if (!body.objectKey.startsWith(`kyc/${params.id}/${body.documentType}/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }

      const column = body.documentType === "ktp" ? "ktpObjectKey" : "selfieObjectKey";
      await db
        .insert(individualVerifications)
        .values({
          campaignId: campaign.id,
          fullName: "",
          nationalId: "",
          dateOfBirth: "",
          address: "",
          city: "",
          postalCode: "",
          [column]: body.objectKey,
        })
        .onConflictDoUpdate({
          target: individualVerifications.campaignId,
          set: { [column]: body.objectKey, updatedAt: new Date() },
        });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: ConfirmKycDocumentBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        400: CampaignErrorSchema2c,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
      },
    },
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: PASS — 4 new tests.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add presigned KYC document upload (ktp + selfie)"
```

---

## Task 8: `GET /campaigns/:id/kyc` + `POST /campaigns/:id/submit`

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `individualVerifications`, `campaigns` (Task 1), `KycStatusSchema`/`SubmitCampaignResponseSchema` (Task 2), `findOwnedCampaign` (Task 6).
- Produces: `GET /campaigns/:id/kyc` — consumed by the KYC layout's SSR load (Task 11) and the `summary` page (Task 14). `POST /campaigns/:id/submit` — consumed by the `summary` page's final submit action (Task 14).

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/campaigns.test.ts`**

```ts
describe("GET /campaigns/:id/kyc", () => {
  test("returns the campaign plus whatever KYC data has been saved so far, defaulting to nulls", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(authedRequest(`http://localhost/campaigns/${campaign.id}/kyc`, TEST_TOKEN));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { campaignId: string; fullName: string | null; ktpObjectKey: string | null };
    expect(body.campaignId).toBe(campaign.id);
    expect(body.fullName).toBeNull();
    expect(body.ktpObjectKey).toBeNull();
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(authedRequest(`http://localhost/campaigns/${campaign.id}/kyc`, OTHER_TOKEN));
    expect(resp.status).toBe(404);
  });
});

describe("POST /campaigns/:id/submit", () => {
  test("flips status from draft to pending_review once both documents are on file", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    for (const documentType of ["ktp", "selfie"] as const) {
      const presignResp = await app.handle(
        authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/presign`, TEST_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType, fileName: `${documentType}.jpg` }),
        }),
      );
      const { uploadUrl, objectKey } = (await presignResp.json()) as { uploadUrl: string; objectKey: string };
      await fetch(uploadUrl, { method: "PUT", body: "fake image bytes" });
      await app.handle(
        authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/confirm`, TEST_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType, objectKey }),
        }),
      );
    }

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, { method: "POST" }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("pending_review");
  });

  test("rejects submission when KTP or selfie is missing", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, { method: "POST" }),
    );
    expect(resp.status).toBe(400);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("draft");
  });

  test("is safe to call again after a successful submit (does not error on an already-pending_review campaign)", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    for (const documentType of ["ktp", "selfie"] as const) {
      const presignResp = await app.handle(
        authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/presign`, TEST_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType, fileName: `${documentType}.jpg` }),
        }),
      );
      const { uploadUrl, objectKey } = (await presignResp.json()) as { uploadUrl: string; objectKey: string };
      await fetch(uploadUrl, { method: "PUT", body: "fake image bytes" });
      await app.handle(
        authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/confirm`, TEST_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType, objectKey }),
        }),
      );
    }
    await app.handle(authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, { method: "POST" }));

    const secondResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, { method: "POST" }),
    );
    expect(secondResp.status).toBe(200);
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, OTHER_TOKEN, { method: "POST" }),
    );
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: FAIL — the two routes don't exist.

- [ ] **Step 3: Implement both endpoints — modify `apps/api/src/routes/campaigns.ts`**

Add `KycStatusSchema`, `SubmitCampaignResponseSchema` to the contracts import line.

```ts
  .get(
    "/:id/kyc",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const [verification] = await db
        .select()
        .from(individualVerifications)
        .where(eq(individualVerifications.campaignId, campaign.id));

      return {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        campaignSlug: campaign.slug,
        campaignStatus: campaign.status,
        fullName: verification?.fullName || null,
        nationalId: verification?.nationalId || null,
        dateOfBirth: verification?.dateOfBirth || null,
        address: verification?.address || null,
        city: verification?.city || null,
        postalCode: verification?.postalCode || null,
        ktpObjectKey: verification?.ktpObjectKey ?? null,
        selfieObjectKey: verification?.selfieObjectKey ?? null,
        consentedAt: verification?.consentedAt?.toISOString() ?? null,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: KycStatusSchema,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
      },
    },
  )
  .post(
    "/:id/submit",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaign(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      if (campaign.status === "pending_review") {
        return { status: campaign.status };
      }

      const [verification] = await db
        .select()
        .from(individualVerifications)
        .where(eq(individualVerifications.campaignId, campaign.id));
      if (!verification?.ktpObjectKey || !verification?.selfieObjectKey) {
        set.status = 400;
        return { error: "kyc_incomplete" };
      }

      await db
        .update(campaigns)
        .set({ status: "pending_review", updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      return { status: "pending_review" };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: SubmitCampaignResponseSchema,
        400: CampaignErrorSchema2c,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
      },
    },
  );
```

(Note the trailing `;` moves to the end of this new last call in the chain.) The `verification?.fullName || null` (rather than `??`) is deliberate: this task's schema task (Task 1/6) stores empty strings as placeholders for not-yet-filled identity/contact fields (see Task 6's design note), so an empty string must be treated the same as "not yet filled in" for THIS read endpoint's purposes — `??` would return `""` instead of `null` for a field the user hasn't actually filled in yet, which is wrong for a status-check endpoint the KYC pages use to pre-fill their own forms. `ktpObjectKey`/`selfieObjectKey`/`consentedAt` use `??` since those columns are genuinely nullable at the schema level with no placeholder-empty-string convention.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts`
Expected: PASS — 6 new tests.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add GET /campaigns/:id/kyc and POST /campaigns/:id/submit"
```

---

## Task 9: KYC wizard layout shell

**Files:**
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/+layout.server.ts`
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/+layout.svelte`
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/kyc-step-order.ts`
- Test: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/kyc-step-order.test.ts`

**Interfaces:**
- Consumes: `createServerApiClient` (Phase 2a), `GET /campaigns/:id/kyc` (Task 8).
- Produces: `getKycStepOrder()`/`nextKycStep()`/`previousKycStep()`, the layout every KYC step page (Tasks 12-14) renders inside.

**Step order:** `identity → contact → consent → upload-ktp → upload-selfie → hold → pending → summary`. (`step-1`/`step-2`/`step-3` from the master plan's route names map to `identity`/`contact`/`consent` here — using descriptive segment names instead of numbered ones, matching this project's own established preference for descriptive step names everywhere else in the wizard; the master plan's exact route strings were never verified from live inspection beyond the numbered count, so this is a legitimate, better naming choice, not a deviation from anything actually confirmed.)

- [ ] **Step 1: Write the failing test — `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/kyc-step-order.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { getKycStepOrder, nextKycStep, previousKycStep } from "./kyc-step-order";

describe("kyc-step-order", () => {
  test("full step order", () => {
    expect(getKycStepOrder()).toEqual([
      "identity",
      "contact",
      "consent",
      "upload-ktp",
      "upload-selfie",
      "hold",
      "pending",
      "summary",
    ]);
  });

  test("nextKycStep returns the following step, or null at the end", () => {
    expect(nextKycStep("identity")).toBe("contact");
    expect(nextKycStep("summary")).toBeNull();
  });

  test("previousKycStep returns the prior step, or null at the start", () => {
    expect(previousKycStep("contact")).toBe("identity");
    expect(previousKycStep("identity")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/kyc-step-order.test.ts"`
Expected: FAIL — `./kyc-step-order` doesn't exist.

- [ ] **Step 3: Implement `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/kyc-step-order.ts`**

```ts
const KYC_STEP_ORDER = [
  "identity",
  "contact",
  "consent",
  "upload-ktp",
  "upload-selfie",
  "hold",
  "pending",
  "summary",
] as const;

export function getKycStepOrder(): string[] {
  return [...KYC_STEP_ORDER];
}

export function nextKycStep(currentStep: string): string | null {
  const index = KYC_STEP_ORDER.indexOf(currentStep as (typeof KYC_STEP_ORDER)[number]);
  if (index === -1 || index === KYC_STEP_ORDER.length - 1) return null;
  return KYC_STEP_ORDER[index + 1] ?? null;
}

export function previousKycStep(currentStep: string): string | null {
  const index = KYC_STEP_ORDER.indexOf(currentStep as (typeof KYC_STEP_ORDER)[number]);
  if (index <= 0) return null;
  return KYC_STEP_ORDER[index - 1] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/kyc-step-order.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Implement the layout's server load — `+layout.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { error, redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, cookies, url }) => {
  // Read unconditionally, before the two redirect(...) branches, so
  // SvelteKit's dependency tracker registers `uses.url` and re-runs this
  // load on every same-page step navigation -- carries forward the fix
  // discovered in Phase 2a's final review; see this plan's Global
  // Constraint. Reused below instead of re-reading url.pathname.
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { data: kyc, error: apiError } = await client.campaigns({ id: params.campaignId }).kyc.get();

  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError?.status === 404 || !kyc || "error" in kyc) {
    error(404, "Campaign tidak ditemukan");
  }

  return { kyc };
};
```

- [ ] **Step 6: Implement the layout shell — `+layout.svelte`**

```svelte
<script lang="ts">
import { Card } from "@galangdana/ui";
import { page } from "$app/state";
import type { LayoutProps } from "./$types";
import { getKycStepOrder } from "./kyc-step-order";

const { data, children }: LayoutProps = $props();

const stepOrder = getKycStepOrder();
const currentIndex = $derived(stepOrder.indexOf(page.url.pathname.split("/").pop() ?? ""));
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
      Verifikasi identitas {data.kyc.campaignTitle} — langkah {currentIndex + 1} dari {stepOrder.length}
    </p>
  </div>

  <Card>
    {@render children()}
  </Card>
</div>
```

This deliberately derives `currentIndex` from the URL path (matching the FIXED pattern from Phase 2a's final review, not the original buggy `data.draft.currentStep`-based one) from the start — do not write the buggy version and then need a second fix round for it.

- [ ] **Step 7: Manually verify the redirect-when-unauthenticated path**

With `apps/api` and `apps/web` running locally (use the `API_PORT=3011`-style port workaround from earlier phases if 3001 is occupied): `curl -i http://localhost:5173/kyc/<any-uuid>/step/identity` (no cookie) — expect a `303` redirect to `/login?redirectTo=...`. (Per Phase 2a's own Task 12 precedent: a directory with only layout files has no independently-routable leaf, so this specific curl needs Task 12's actual leaf page — `identity` — to exist, which by this point in the plan it does not yet if you're doing tasks strictly in order; if you hit a 404 instead of a 303, that's the expected SvelteKit routing behavior for a layout-only path, not a bug — note it in your report and move on, or temporarily stub a throwaway `+page.svelte` to verify the redirect logic specifically, deleting it before committing, matching Phase 2a Task 12's own precedent for this exact situation.)

- [ ] **Step 8: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): add KYC wizard layout shell with SSR auth and step progress"
```

---

## Task 10: Wire `rangkuman`'s real submit action

**Files:**
- Modify: `apps/web/src/routes/(campaigner)/create/[draftId]/step/rangkuman/+page.svelte`
- Modify: `apps/web/src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts`

**Interfaces:**
- Consumes: `POST /campaigns` (Task 5).
- Produces: the real "Ajukan Verifikasi" action Phase 2a's Task 19 deliberately left unbuilt ("Deliberately no working Submit action ... this plan's own scope explicitly stops before individual KYC").

Read the CURRENT `rangkuman/+page.svelte` before editing — it presently shows a static notice paragraph ("Verifikasi identitas dan pengajuan akhir campaign akan tersedia setelah langkah verifikasi ditambahkan pada tahap berikutnya.") and only a "Kembali" button. This task replaces that notice with a real, working button.

- [ ] **Step 1: Write the failing test — append to `apps/web/src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts`**

```ts
test("shows a working submit button that creates a real campaign and navigates to KYC", async () => {
  const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "22222222-2222-2222-2222-222222222222", slug: "bantu-aldi-sembuh" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

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

  await fireEvent.click(screen.getByRole("button", { name: "Ajukan Verifikasi" }));
  await new Promise((r) => setTimeout(r, 0));

  expect(fetchSpy).toHaveBeenCalled();
  expect(goto).toHaveBeenCalledWith("/kyc/22222222-2222-2222-2222-222222222222/step/identity");

  fetchSpy.mockRestore();
});
```

Check this test file's current imports (it may not yet import `fireEvent`/`vi`/mock `$app/navigation`'s `goto` — add whatever's missing, matching the established pattern from `pasien/page.render.test.ts` or any of the Phase 2a fix-wave step pages that already mock `goto`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts"`
Expected: FAIL — no such button exists yet.

- [ ] **Step 3: Implement the real submit action — modify `+page.svelte`**

Add to the `<script>` block:

```ts
let submitting = $state(false);
let error = $state<string | null>(null);

async function submitForVerification() {
  error = null;
  submitting = true;
  const { data: created, error: apiError } = await api.campaigns.post({ draftId: data.draft.id });
  submitting = false;
  if (apiError || !created) {
    error = "Gagal mengajukan campaign untuk verifikasi. Silakan coba lagi.";
    return;
  }
  await goto(`/kyc/${created.id}/step/identity`);
}
```

Add `import { api } from "$lib/api-client";` to the imports if not already present. Replace the existing static notice `<p>` and the lone "Kembali" button's surrounding markup with:

```svelte
  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={back} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button
      type="button"
      onclick={submitForVerification}
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Ajukan Verifikasi
    </button>
  </div>
```

(Keep the existing `<dl>` summary block above this untouched — only the bottom action area changes. `api.campaigns.post(...)` uses plain dot notation, not bracket notation — the `/campaigns` prefix has no hyphen, so Eden Treaty's camelCasing is a non-issue here, unlike `campaign-drafts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/create/[draftId]/step/rangkuman/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): wire rangkuman's real 'Ajukan Verifikasi' submit action"
```

---

## Task 11: KYC `identity` + `contact` step pages (batched)

**Files (2 pages + 2 tests, all new):**
- `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/identity/+page.svelte` (+ `page.render.test.ts`)
- `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/contact/+page.svelte` (+ `page.render.test.ts`)

**Interfaces:**
- Consumes: `data.kyc` (Task 9's layout), `PUT /campaigns/:id/kyc/identity` / `PUT /campaigns/:id/kyc/contact` (Task 6), `nextKycStep`/`previousKycStep` (Task 9).
- Produces: 2 working KYC steps.

Batched per this project's established same-shape-work guidance (Phase 2a's Task 14 precedent). Both mirror the simple-field step template from `create/[draftId]/step/tujuan/+page.svelte`, adapted for multiple fields per step (closer to `pasien/+page.svelte`'s shape, since each step here collects 2-3 fields, not one).

- [ ] **Step 1: Write the 2 failing tests**

`identity/page.render.test.ts`:

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const KYC = {
  campaignId: "11111111-1111-1111-1111-111111111111",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  campaignStatus: "draft",
  fullName: null,
  nationalId: null,
  dateOfBirth: null,
  address: null,
  city: null,
  postalCode: null,
  ktpObjectKey: null,
  selfieObjectKey: null,
  consentedAt: null,
};

describe("kyc identity step rendering", () => {
  test("renders empty fields by default", () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    expect((screen.getByLabelText("Nama lengkap (sesuai KTP)") as HTMLInputElement).value).toBe("");
  });

  test("pre-fills from existing saved identity data", () => {
    render(Page, {
      props: {
        data: { kyc: { ...KYC, fullName: "Aldi Setiawan", nationalId: "3271234567890001", dateOfBirth: "1990-05-12" } },
        params: { campaignId: KYC.campaignId },
      },
    });
    expect((screen.getByLabelText("Nama lengkap (sesuai KTP)") as HTMLInputElement).value).toBe("Aldi Setiawan");
  });
});
```

`contact/page.render.test.ts`:

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const KYC = {
  campaignId: "11111111-1111-1111-1111-111111111111",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  campaignStatus: "draft",
  fullName: null,
  nationalId: null,
  dateOfBirth: null,
  address: null,
  city: null,
  postalCode: null,
  ktpObjectKey: null,
  selfieObjectKey: null,
  consentedAt: null,
};

describe("kyc contact step rendering", () => {
  test("renders empty fields by default", () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    expect((screen.getByLabelText("Alamat") as HTMLTextAreaElement).value).toBe("");
  });

  test("pre-fills from existing saved contact data", () => {
    render(Page, {
      props: {
        data: { kyc: { ...KYC, address: "Jl. Merdeka No. 1", city: "Bandung", postalCode: "40111" } },
        params: { campaignId: KYC.campaignId },
      },
    });
    expect((screen.getByLabelText("Kota") as HTMLInputElement).value).toBe("Bandung");
  });
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/{identity,contact}/page.render.test.ts"`
Expected: FAIL — neither component exists.

- [ ] **Step 3: Implement `identity/+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextKycStep, previousKycStep } from "../kyc-step-order";

const { data }: PageProps = $props();

let fullName = $state(data.kyc.fullName ?? "");
let nationalId = $state(data.kyc.nationalId ?? "");
let dateOfBirth = $state(data.kyc.dateOfBirth ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  const incomplete = !fullName.trim() || nationalId.trim().length !== 16 || !dateOfBirth.trim();
  if (direction === "next" && incomplete) {
    error = "Lengkapi nama, NIK (16 digit), dan tanggal lahir.";
    return;
  }
  if (direction === "back" && incomplete) {
    const target = previousKycStep("identity");
    if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
    return;
  }
  submitting = true;
  const { error: apiError } = await api
    .campaigns({ id: data.kyc.campaignId })
    .kyc.identity.put({ fullName, nationalId, dateOfBirth });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan. Silakan coba lagi.";
    return;
  }
  const target = direction === "next" ? nextKycStep("identity") : previousKycStep("identity");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Data Diri</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="full-name" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nama lengkap (sesuai KTP)</label>
    <input id="full-name" type="text" bind:value={fullName} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="national-id" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nomor Induk Kependudukan (NIK)</label>
    <input id="national-id" type="text" maxlength="16" bind:value={nationalId} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="dob" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Tanggal lahir</label>
    <input id="dob" type="date" bind:value={dateOfBirth} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
```

Note: the `<input type="date">` binding is a plain native input, not `type="number"` — it does not hit the Svelte `bind:value` numeric-coercion bug Phase 2a's final review found (that bug is specific to `type="number"`; `type="date"` binds a plain string via `bind:value` with no coercion, confirmed safe to use directly here).

- [ ] **Step 4: Implement `contact/+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { nextKycStep, previousKycStep } from "../kyc-step-order";

const { data }: PageProps = $props();

let address = $state(data.kyc.address ?? "");
let city = $state(data.kyc.city ?? "");
let postalCode = $state(data.kyc.postalCode ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  const incomplete = !address.trim() || !city.trim() || !postalCode.trim();
  if (direction === "next" && incomplete) {
    error = "Lengkapi alamat, kota, dan kode pos.";
    return;
  }
  if (direction === "back" && incomplete) {
    const target = previousKycStep("contact");
    if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
    return;
  }
  submitting = true;
  const { error: apiError } = await api
    .campaigns({ id: data.kyc.campaignId })
    .kyc.contact.put({ address, city, postalCode });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan. Silakan coba lagi.";
    return;
  }
  const target = direction === "next" ? nextKycStep("contact") : previousKycStep("contact");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Alamat</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="address" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Alamat</label>
    <textarea id="address" bind:value={address} rows="2" class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"></textarea>
  </div>
  <div class="mb-4">
    <label for="city" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kota</label>
    <input id="city" type="text" bind:value={city} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="postal-code" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kode pos</label>
    <input id="postal-code" type="text" bind:value={postalCode} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
```

- [ ] **Step 5: Run both to verify they pass**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/{identity,contact}/page.render.test.ts"`
Expected: PASS — 4 tests total.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add KYC identity and contact steps"
```

---

## Task 12: KYC `consent` step

**Files:**
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/consent/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/consent/page.render.test.ts`

**Interfaces:**
- Consumes: `data.kyc` (Task 9's layout), `nextKycStep`/`previousKycStep` (Task 9).
- Produces: the KYC wizard's consent gate before document upload.

No dedicated API endpoint for this step — it is a UI-only checkbox gate (per this plan's design note: "step 3 = a final acknowledgment/consent step... no separate endpoint needed"). Consent is a client-side gate on proceeding to `upload-ktp`; it is not separately persisted server-side in this phase (a real production system would record consent with a timestamp/IP for compliance purposes — noted as a known gap in this plan's Risks section, not silently glossed over).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const KYC = {
  campaignId: "11111111-1111-1111-1111-111111111111",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  campaignStatus: "draft",
  fullName: "Aldi Setiawan",
  nationalId: "3271234567890001",
  dateOfBirth: "1990-05-12",
  address: "Jl. Merdeka No. 1",
  city: "Bandung",
  postalCode: "40111",
  ktpObjectKey: null,
  selfieObjectKey: null,
  consentedAt: null,
};

describe("kyc consent step rendering", () => {
  test("Lanjutkan is disabled until the consent checkbox is checked", async () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    const nextButton = screen.getByRole("button", { name: "Lanjutkan" }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);

    await fireEvent.click(screen.getByRole("checkbox"));
    expect(nextButton.disabled).toBe(false);

    await fireEvent.click(nextButton);
    await new Promise((r) => setTimeout(r, 0));
    expect(goto).toHaveBeenCalledWith(`/kyc/${KYC.campaignId}/step/upload-ktp`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/consent/page.render.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 3: Implement the page**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import type { PageProps } from "./$types";
import { nextKycStep, previousKycStep } from "../kyc-step-order";

const { data }: PageProps = $props();

let agreed = $state(false);

async function proceed(direction: "next" | "back") {
  const target = direction === "next" ? nextKycStep("consent") : previousKycStep("consent");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Persetujuan Verifikasi</h2>
  <p class="mb-4 font-sans text-sm text-neutral-600">
    Dengan melanjutkan, Anda menyetujui bahwa data dan dokumen identitas yang Anda unggah akan
    digunakan untuk memverifikasi identitas Anda sebagai penggalang dana pada platform ini.
  </p>

  <label class="mb-6 flex items-center gap-2 font-sans text-sm">
    <input type="checkbox" bind:checked={agreed} />
    Saya menyetujui dan data yang saya berikan adalah benar
  </label>

  <div class="flex justify-between">
    <button type="button" onclick={() => proceed("back")} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button
      type="button"
      onclick={() => proceed("next")}
      disabled={!agreed}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Lanjutkan
    </button>
  </div>
</div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/consent/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add KYC consent step"
```

---

## Task 13: KYC document upload (`upload-ktp` + `upload-selfie`)

**Files:**
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/kyc-upload/kyc-upload-page.svelte`
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/upload-ktp/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/upload-selfie/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/kyc-upload/kyc-upload-page.test.ts`

**Interfaces:**
- Consumes: `data.kyc` (Task 9's layout), `POST /campaigns/:id/kyc/documents/presign` + `/confirm` (Task 7), `nextKycStep`/`previousKycStep` (Task 9).
- Produces: the two document-upload steps, sharing one real implementation.

The master plan's route list keeps `upload-id` and `upload-selfie` as two distinct routes (matching two distinct moments in the user's flow — take/upload your KTP photo, then take/upload your selfie), but their actual upload mechanics are identical (mirrors Phase 2a Task 10's presign→PUT→confirm flow exactly, just varying the `documentType`). Rather than duplicating that logic twice, this task builds ONE real component (`kyc-upload-page.svelte`, not itself a route — it lives in a plain, non-route-segment directory `kyc-upload/` so SvelteKit does not treat it as a page) parameterized by `documentType`, and two nearly-empty route files that each import and render it with their own `documentType`.

- [ ] **Step 1: Write the failing test — `kyc-upload/kyc-upload-page.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import KycUploadPage from "./kyc-upload-page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const KYC = {
  campaignId: "11111111-1111-1111-1111-111111111111",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  campaignStatus: "draft",
  fullName: "Aldi Setiawan",
  nationalId: "3271234567890001",
  dateOfBirth: "1990-05-12",
  address: "Jl. Merdeka No. 1",
  city: "Bandung",
  postalCode: "40111",
  ktpObjectKey: null,
  selfieObjectKey: null,
  consentedAt: null,
};

describe("kyc-upload-page", () => {
  test("shows the correct heading for ktp vs selfie", () => {
    const { unmount } = render(KycUploadPage, {
      props: { data: { kyc: KYC }, documentType: "ktp", stepName: "upload-ktp", heading: "Unggah Foto KTP" },
    });
    expect(screen.getByText("Unggah Foto KTP")).not.toBeNull();
    unmount();

    render(KycUploadPage, {
      props: { data: { kyc: KYC }, documentType: "selfie", stepName: "upload-selfie", heading: "Unggah Foto Selfie" },
    });
    expect(screen.getByText("Unggah Foto Selfie")).not.toBeNull();
  });

  test("shows an already-uploaded indicator when the corresponding objectKey is present", () => {
    render(KycUploadPage, {
      props: {
        data: { kyc: { ...KYC, ktpObjectKey: "kyc/x/ktp/y.jpg" } },
        documentType: "ktp",
        stepName: "upload-ktp",
        heading: "Unggah Foto KTP",
      },
    });
    expect(screen.getByText(/sudah diunggah/)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/kyc-upload/kyc-upload-page.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 3: Implement `kyc-upload/kyc-upload-page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { invalidateAll } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextKycStep, previousKycStep } from "../kyc-step-order";

interface Props {
  data: { kyc: { campaignId: string; ktpObjectKey: string | null; selfieObjectKey: string | null } };
  documentType: "ktp" | "selfie";
  stepName: string;
  heading: string;
}

const { data, documentType, stepName, heading }: Props = $props();

const alreadyUploaded = $derived(documentType === "ktp" ? data.kyc.ktpObjectKey : data.kyc.selfieObjectKey);

let selectedFile: File | null = $state(null);
let uploading = $state(false);
let error = $state<string | null>(null);

async function upload() {
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  error = null;
  uploading = true;

  const { data: presign, error: presignError } = await api
    .campaigns({ id: data.kyc.campaignId })
    .kyc.documents.presign.post({ documentType, fileName: selectedFile.name });
  if (presignError || !presign) {
    uploading = false;
    error = "Gagal menyiapkan unggahan. Periksa format file (jpg/jpeg/png).";
    return;
  }

  const putResp = await fetch(presign.uploadUrl, { method: "PUT", body: selectedFile });
  if (!putResp.ok) {
    uploading = false;
    error = "Gagal mengunggah file.";
    return;
  }

  const { error: confirmError } = await api
    .campaigns({ id: data.kyc.campaignId })
    .kyc.documents.confirm.post({ documentType, objectKey: presign.objectKey });
  uploading = false;
  if (confirmError) {
    error = "Gagal menyimpan dokumen.";
    return;
  }

  selectedFile = null;
  await invalidateAll();
}

async function proceed(direction: "next" | "back") {
  const target = direction === "next" ? nextKycStep(stepName) : previousKycStep(stepName);
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">{heading}</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if alreadyUploaded}
    <p class="mb-4 font-sans text-sm text-neutral-600">Dokumen sudah diunggah.</p>
  {/if}

  <div class="mb-4">
    <label for="doc-file" class="mb-1 block font-sans text-sm font-medium text-neutral-900">File (jpg, jpeg, png)</label>
    <input
      id="doc-file"
      type="file"
      accept=".jpg,.jpeg,.png"
      onchange={(e) => (selectedFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
    />
  </div>

  <button
    type="button"
    onclick={upload}
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

- [ ] **Step 4: Implement the two thin route wrappers**

`upload-ktp/+page.svelte`:

```svelte
<script lang="ts">
import KycUploadPage from "../kyc-upload/kyc-upload-page.svelte";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<KycUploadPage {data} documentType="ktp" stepName="upload-ktp" heading="Unggah Foto KTP" />
```

`upload-selfie/+page.svelte`:

```svelte
<script lang="ts">
import KycUploadPage from "../kyc-upload/kyc-upload-page.svelte";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<KycUploadPage {data} documentType="selfie" stepName="upload-selfie" heading="Unggah Foto Selfie" />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/kyc-upload/kyc-upload-page.test.ts"`
Expected: PASS — 2 tests.

- [ ] **Step 6: Manually verify a real upload round-trip**

Same pattern as Phase 2a's Task 17 Step 6: with `apps/api` and `apps/web` running locally and a real session cookie, create a real campaign via curl (`POST /campaign-drafts` → fill in answers → `POST /campaigns`), then `curl` the rendered `upload-ktp` page for a 200, and separately re-run `cd apps/api && bun test src/routes/campaigns.test.ts` as this task's own confirmation that the presign→PUT→confirm flow it depends on hasn't drifted. Report actual output.

- [ ] **Step 7: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): add KYC document upload (ktp + selfie, shared implementation)"
```

---

## Task 14: `hold` / `pending` / `summary` pages + final submit action

**Files:**
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/hold/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/pending/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/summary/+page.svelte`
- Test: `apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/summary/page.render.test.ts`

**Interfaces:**
- Consumes: `data.kyc` (Task 9's layout), `POST /campaigns/:id/submit` (Task 8), `previousKycStep`/`nextKycStep` (Task 9).
- Produces: the KYC wizard's final honest status pages and the actual submission trigger.

**`hold`**: a brief, honest interstitial shown right after document upload, before the user reaches the summary — matching this plan's Global Constraint ("No Placeholders": do not fake a real-time third-party verification status). It is a static page with a single "Lanjutkan" button (no polling, no fake progress spinner tied to nothing real).

**`pending`**: shown AFTER a successful `POST /campaigns/:id/submit` — a static, honest "your campaign is under review" status page. No real-time polling of moderation status in this phase (Phase 3 builds the admin side; nothing yet updates this page live).

**`summary`**: the KYC wizard's read-only review + the actual "Ajukan Campaign" submit button, mirroring `rangkuman`'s read-only-then-act shape but for KYC data, and — unlike `rangkuman` — this page's submit button IS real and working (this plan's whole purpose).

- [ ] **Step 1: Implement `hold/+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import type { PageProps } from "./$types";
import { nextKycStep } from "../kyc-step-order";

const { data }: PageProps = $props();

async function proceed() {
  const target = nextKycStep("hold");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Dokumen Diterima</h2>
  <p class="mb-6 font-sans text-sm text-neutral-600">
    Dokumen identitas Anda telah kami terima. Silakan lanjutkan untuk meninjau dan mengajukan
    campaign Anda untuk verifikasi.
  </p>
  <button type="button" onclick={proceed} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark">
    Lanjutkan
  </button>
</div>
```

- [ ] **Step 2: Implement `pending/+page.svelte`**

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Menunggu Peninjauan</h2>
  <p class="font-sans text-sm text-neutral-600">
    Campaign <strong>{data.kyc.campaignTitle}</strong> sedang menunggu peninjauan tim kami. Anda akan
    diberi tahu setelah proses peninjauan selesai.
  </p>
</div>
```

- [ ] **Step 3: Write the failing test for `summary` — `summary/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const KYC = {
  campaignId: "11111111-1111-1111-1111-111111111111",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  campaignStatus: "draft",
  fullName: "Aldi Setiawan",
  nationalId: "3271234567890001",
  dateOfBirth: "1990-05-12",
  address: "Jl. Merdeka No. 1",
  city: "Bandung",
  postalCode: "40111",
  ktpObjectKey: "kyc/x/ktp/y.jpg",
  selfieObjectKey: "kyc/x/selfie/z.jpg",
  consentedAt: null,
};

describe("kyc summary page rendering", () => {
  test("shows the collected identity/contact data", () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    expect(screen.getByText("Aldi Setiawan")).not.toBeNull();
    expect(screen.getByText("Bandung")).not.toBeNull();
  });

  test("clicking Ajukan Campaign submits and navigates to pending", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_review" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    await fireEvent.click(screen.getByRole("button", { name: "Ajukan Campaign" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith(`/kyc/${KYC.campaignId}/step/pending`);
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/summary/page.render.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 5: Implement `summary/+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";
import { previousKycStep } from "../kyc-step-order";

const { data }: PageProps = $props();

let submitting = $state(false);
let error = $state<string | null>(null);

async function back() {
  const target = previousKycStep("summary");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}

async function submitCampaign() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.campaigns({ id: data.kyc.campaignId }).submit.post();
  submitting = false;
  if (apiError) {
    error = "Gagal mengajukan campaign. Pastikan dokumen KTP dan selfie sudah diunggah.";
    return;
  }
  await goto(`/kyc/${data.kyc.campaignId}/step/pending`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Ringkasan Verifikasi</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <dl class="mb-6 space-y-4 font-sans text-sm">
    <div>
      <dt class="font-medium text-neutral-900">Nama lengkap</dt>
      <dd class="text-neutral-600">{data.kyc.fullName}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">NIK</dt>
      <dd class="text-neutral-600">{data.kyc.nationalId}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">Tanggal lahir</dt>
      <dd class="text-neutral-600">{data.kyc.dateOfBirth}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">Alamat</dt>
      <dd class="text-neutral-600">{data.kyc.address}, {data.kyc.city} {data.kyc.postalCode}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">Dokumen</dt>
      <dd class="text-neutral-600">
        KTP: {data.kyc.ktpObjectKey ? "sudah diunggah" : "belum diunggah"} ·
        Selfie: {data.kyc.selfieObjectKey ? "sudah diunggah" : "belum diunggah"}
      </dd>
    </div>
  </dl>

  <div class="flex justify-between">
    <button type="button" onclick={back} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button
      type="button"
      onclick={submitCampaign}
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Ajukan Campaign
    </button>
  </div>
</div>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/kyc/[campaignId]/step/summary/page.render.test.ts"`
Expected: PASS — 2 tests.

- [ ] **Step 7: Manually verify the complete end-to-end flow, one final time**

With `apps/api` and `apps/web` running locally, and a valid session cookie: walk the REAL API sequence this whole plan built, entirely via curl — create a draft, fill in the required rangkuman fields, `POST /campaigns`, save identity, save contact, presign+PUT+confirm both ktp and selfie, `POST /campaigns/:id/submit`, then `GET /campaigns/:id/kyc` and confirm `campaignStatus: "pending_review"`. This is this plan's final end-to-end confidence check — report the full sequence's actual output.

- [ ] **Step 8: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): add KYC hold/pending/summary pages and the real submit action"
```

---

## Verification

- **Unit** (`bun test` across `packages/db`, `apps/api`; `vitest` across `apps/web`): every new schema, route, and component has a real test asserting actual behavior against real infrastructure (real Postgres, real MinIO presigned uploads) — no mocking of the database or storage layer, matching every earlier phase's established testing philosophy.
- **Ownership enforcement**: every new authenticated `campaigns`-scoped endpoint returns 404 (never 403) for a campaign that exists but belongs to someone else — verified by a dedicated cross-user test on every one of Tasks 5-8's endpoints.
- **Security**: the KYC document objectKey is always server-generated, never client-supplied (Task 7, mirroring Task 10's already-verified pattern); the presigned-upload confirm step rejects an objectKey outside the requesting campaign's own prefix.
- **Money**: `campaigns.goalAmount` is parsed from the draft's decimal-string `goalAmountStr` exactly once, at creation (Task 5) — verified by asserting the real `bigint` value in the database, not just that the endpoint returns 200.
- **Draft/campaign linkage**: `campaigns.draftId` correctly points back to its origin and survives draft deletion as `NULL` (Task 1's own test).
- **Auth linkage**: `getOrCreateCampaignerForUser` is idempotent per user — a second call never creates a duplicate `campaigners` row (Task 4's own test).

## Risks

- **No real third-party KYC verification.** This plan collects identity fields and document photos and stores them; it does NOT call any real identity-verification API (none was ever identified in the master plan's research — genuinely unverified vendor, same category as Sumopod/kirim.dev). `individual_verifications.status` starts and stays `"pending"` until a human reviews it, which is Phase 3's job, not built here.
- **No cover-photo collection.** The wizard (Phase 2a) never asks for a cover image; `campaigns.coverMediaUrl` is `NULL` for every campaign this plan creates. A campaign detail page rendering this campaign (Phase 1's read-only display) will show no cover image until a later follow-up adds a cover-upload step somewhere in this flow.
- **Consent is not durably recorded.** Task 12's consent checkbox is a client-side gate only — no timestamp/IP is persisted server-side in this phase. A real production system handling identity documents would need this for compliance; flagged here rather than silently treated as done.
- **KYC step-1/2/3 field content (NIK format validation beyond a 16-character length check, address format, etc.) is original, not verified from live inspection** — only the route existence and step count were ever confirmed from the master plan's research; the actual fields collected here are a reasonable, minimal design, same caveat as Phase 2a's guided story questions.
- **No re-submission/edit flow after `pending_review`.** Once a campaign is submitted, this plan has no "amend and resubmit" path if Phase 3's moderation queue later requests a revision — that's explicitly Phase 3's `needs_revision` status transition and revision UI to build, not this plan's.
- **RAB (budget) module remains completely out of scope**, as it was for Phase 2a. A submitted campaign has a goal amount but no structured budget breakdown.
