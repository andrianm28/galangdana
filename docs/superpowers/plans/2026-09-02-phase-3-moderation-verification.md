# Phase 3: Moderation + Verification (Individual Track) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GalangDana an admin moderation queue that can approve or request revisions on submitted individual-track campaigns, and a campaigner-facing revision loop that lets a campaigner see what's wrong, fix it, and resubmit — the missing link that makes Phase 2c's `pending_review` status actually go somewhere.

**Architecture:** New `apps/api` admin routes (role-gated, not ownership-gated — a genuinely different authorization model from every prior route in this codebase) alongside new campaigner-facing revision/edit endpoints on the existing `campaigns.ts` route file. New `apps/web` surface: a real admin dashboard (replacing the Phase 0 stub) and the first version of a campaigner dashboard. A new `campaign_revisions` table records field-scoped revision requests; `campaign_documents` gains a nullable `campaignId` so a re-uploaded document isn't tied to an ephemeral draft.

**Tech Stack:** SvelteKit 2 (adapter-node), ElysiaJS on Bun, Drizzle + Postgres, TypeBox contracts + Eden Treaty, Bun's S3Client for presigned uploads/downloads, Meilisearch.

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` (master plan — Phase 3's original scope, Module Map, Domain Model, Risks) and `docs/superpowers/plans/2026-09-02-phase-2c-individual-kyc-submission.md` (Phase 2c — the immediately preceding phase this one builds directly on; its Global Constraints and Domain Model sections are the most reliable, code-grounded picture of what exists today).

## Scope note — read this before anything else

The master plan's original Phase 3 scope was "admin queue, field-scoped revisions, document review, **self-serve org verification**." This plan deliberately **excludes org verification** and one item from the revision taxonomy (**`penerima`**, i.e. beneficiary/patient info) — see "Explicitly Out of Scope" below for why, and what a future phase would need to build first. Everything else — the admin moderation queue, document review (including KYC documents), and 8 of the 9 field-scoped revision types — is in scope and fully specified below.

### Explicitly Out of Scope (and why)

- **Self-serve organization verification.** No organization-backed campaign creation path exists anywhere in this codebase — Phase 2a/2c only built the **individual** track (`campaigners.type: individual`, individual KYC via `individual_verifications`). `campaigners.type` already has `"yayasan"` as a valid enum value and `campaigners.verifiedAt` already exists as a column, but nothing ever sets either up for an org. Building org verification here would mean inventing an entire parallel campaign-creation flow (NPWP, notarial deed, officer identity, organizational structure) with no wizard to attach it to — exactly the kind of prerequisite gap that led to Phase 2c being inserted before this phase in the first place. A future phase needs to build organization-backed campaign creation first; org verification is that phase's second half, not this one's.
- **`penerima` (beneficiary/patient) revisions.** Verified directly against the schema: `patients` and `beneficiaries` (`packages/db/src/schema/patients.ts`, `beneficiaries.ts`) are both `draftId`-scoped with a `NOT NULL UNIQUE` constraint — they have **no campaign-scoped equivalent**. `campaigns.story` and `campaigns.goalAmount`, by contrast, are plain columns directly on the `campaigns` table (set once at `POST /campaigns` time from the draft, then owned by the campaign itself) — trivially editable post-submission. Patient/beneficiary data has no such campaign-scoped home; letting a campaigner revise it after submission would require adding new campaign-scoped patient/beneficiary tables (real schema design, not a per-field edit endpoint) or reworking how drafts survive past their 7-day TTL. That's real, separate design work belonging to a follow-up task, not squeezed into this plan's revision loop. The other 8 revision types from the master plan's taxonomy (`cerita`, `target-donasi`, `kartu-mahasiswa`, `kartu-pelajar`, `tagihan-rumah-sakit`, `tagihan-institusi-pendidikan`, `media-sosial`, `sumber-gambar`) are fully covered.
- **Real-time/live document verification against a 3rd-party vendor.** Same as Phase 2c: no vendor was ever identified. A moderator's approve/reject decision in this plan is a human judgment call reviewing the stored KTP/selfie photos, not an automated check.
- **The originally-designed admin surface.** Unlike the consumer/campaigner route groups (mapped from live inspection of the real Kitabisa platform), the master plan's own Module Map lists "Admin" with no real routes ever specified — it's `*ours*` throughout. Every admin route this plan adds is original design, not a clone of anything observed.

## Global Constraints

- **Money is bigint minor-unit rupiah, never float** (repo-wide constraint since Phase 0a). No new money value is parsed in this plan — `campaigns.goalAmount` already exists as a `bigint`; the revision loop's goal-amount edit endpoint receives and validates a decimal string exactly like `POST /campaigns` did in Phase 2c, using the same `/^\d+$/` regex guard before `BigInt(...)`.
- **Two distinct authorization models, and every new endpoint in this plan must use the correct one — do not conflate them:**
  - **Ownership-scoped 404-not-403** (established since Phase 2a, unchanged): every campaigner-facing endpoint that operates on a specific `campaigns.id` scopes its query so a non-owner's request produces the IDENTICAL 404 as a nonexistent campaign. Applies to every endpoint in Tasks 7 and 8 below.
  - **Role-scoped 401/403** (new in this plan): every admin endpoint checks `user` is present (401 if not) and `user.role === "admin"` (403 if not) — via the shared `checkAdmin()` helper from Task 4. Admin endpoints are NOT ownership-scoped — an admin can act on ANY campaign, and a 403 for "authenticated but not an admin" is the correct, intentional signal here (unlike the ownership pattern, there's no reason to hide from a non-admin user that the `/admin/*` surface exists).
- **`CampaignErrorSchema2c` (from Phase 2c) is a known, already-flagged duplicate of the pre-existing `CampaignErrorSchema` — do NOT repeat that mistake.** Every new error response in this plan reuses `CampaignErrorSchema` (`packages/contracts/src/campaigns.ts`), never a new phase-suffixed schema.
- **Eden Treaty kebab-case bracket-notation gotcha, and the route-merging TYPE-level conflict, both verified repeatedly in Phase 2a/2c:** a route mounted at `/admin` or `/campaigns` (no hyphens) resolves fine via plain dot notation. But if a NEW dynamically-parameterized route shares a path depth with an EXISTING route using a differently-named param, Eden merges their types into an intersection that neither call can satisfy alone. This plan's new `/campaigns/:id/story`, `/campaigns/:id/goal-amount`, `/campaigns/:id/documents/presign`, `/campaigns/:id/documents/confirm`, and `/campaigns/:id/revisions` routes all share the `/campaigns/:id/...` depth with Phase 2c's existing KYC routes (all `:id`-named, so no NEW collision is expected there) — but Phase 1's pre-existing `GET /campaigns/:slug` uses a DIFFERENT param name at the shallower `/campaigns/:X` depth, which is the depth `POST /campaigns/:id/submit` etc. already share. If `bun run typecheck` reports a merged-intersection error on a NEW frontend call in this plan (the error looks like `Property 'id' is missing in type '{ slug: string }'` or similar), apply the SAME established two-part fix already used four times in Phase 2c (Task 9 commit `89494f4`, reused in Tasks 11/13/14): cast the base callable `(api.campaigns as any)({ id: ... })`, then re-cast the awaited result to Eden's real `Treaty.TreatyResponse<{200: T, ...}>` type matching the endpoint's actual response map. Never leave the cast on just the callable — that erases type-checking on the whole downstream chain, including the request body.
- **Presigned document access, established in Phase 2a/2c and security-sound — the pattern this plan extends to READS for the first time:** every existing presign in this codebase is `method: "PUT"` (upload). This plan's admin document-viewing needs the first `method: "GET"` presign (Bun's `S3Client.file(key).presign({...})` supports both identically). The objectKey for a GET presign must always come from a value ALREADY STORED in the database (never client-supplied) — same trust boundary as the existing upload flow, just inverted.
- **`apps/web` test-file gotchas, established across Phase 2a/2c:**
  - Any test file whose component (transitively) imports `$lib/api-client` needs `vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }))` at the top.
  - Any test exercising a component that calls `goto(...)` needs `vi.mock("$app/navigation", () => ({ goto: (...args) => goto(...args) }))` with a `vi.fn()`-backed `goto`.
  - A dynamic-route page's `render(Page, { props: { data, params, ... } })` call needs a real `params` object matching the route's dynamic segments.
- **The authenticated cross-origin SSR pattern** (`createServerApiClient` from `apps/web/src/lib/server-api-client.ts`, `+page.server.ts`/`+layout.server.ts` reading `event.cookies`) applies to every new SSR page in this plan, including the admin layout. The `uses.url`-tracking fix (read `url.pathname` unconditionally, before any conditional branch, so SvelteKit re-runs the load on step navigation) must be carried forward into the new admin `+layout.server.ts` exactly as it was in Phase 2c's KYC layout.
- **`bun run lint` clean before every commit** — non-negotiable, repeated in every phase of this project.
- **This repo is 100% Bun tooling. Never npm/yarn/npx.**
- **`bun` may not be on PATH in a fresh shell**, especially inside an isolated git worktree. It is installed at `/home/ubuntu/.bun/bin/bun` (v1.4.0). Either `export PATH="/home/ubuntu/.bun/bin:$PATH"` first, or invoke via the full path.
- **`apps/api` tests need `--env-file=../../.env`** (a bare `cd apps/api && bun test` misses the repo root `.env` and causes unrelated search/meilisearch test failures). A freshly created worktree also needs the repo root `.env` FILE COPIED IN MANUALLY — it is untracked/gitignored and does not carry over automatically; if a fresh worktree's baseline test run fails with `DataError: Zero-length key is not supported` from `packages/media/src/imgproxy.ts`, that is this exact missing-`.env` gotcha, not a real regression — copy `.env` from the main repo checkout and re-run.
- **Repo-wide `bun run typecheck` (from the worktree root), never package-scoped only, for every task.** Phase 2c has a documented incident (Task 6) where a package-scoped-only typecheck missed a real cross-package Eden Treaty regression that the repo-wide command would have caught immediately.
- **Search indexing is currently additive-only and manual.** `packages/search/src/campaigns-index.ts`'s `syncCampaignsIndex()` is documented as safe to call with a single upserted document (it does NOT do a destructive full-replace) — this plan's approve action is explicitly named in that file's own doc comment as "a future phase that adds live campaign creation/status changes," and this is that phase. Call `syncCampaignsIndex([document])` with the single newly-approved campaign on every approve; do not attempt index removal (rejecting/pausing an already-active campaign is out of scope for this plan — nothing in this plan makes an active campaign non-active again).
- **No self-serve admin signup or invite flow in this plan.** Promoting a user to `role: "admin"` is a direct database update (`UPDATE users SET role = 'admin' WHERE email = '...'`), documented as an intentional, minimal decision for a first version — not a silently-missed gap. A future phase can build a real admin-invite flow if needed.

## Domain Model / Interfaces Summary

New/changed tables (all in `packages/db/src/schema/`):
- `users` (existing) gains: `role: user_role enum ("campaigner" | "admin"), NOT NULL, default "campaigner"`.
- `campaigns` (existing) gains: `submittedAt: timestamp (nullable)` — set once by `POST /campaigns/:id/submit` (Phase 2c, extended in Task 6 below), read by the admin queue for accurate sort order (a more precise signal than reusing `updatedAt`, which several other writes also touch).
- `campaign_documents` (existing) gains: `campaignId: uuid (nullable, FK -> campaigns.id, onDelete: cascade)`, and its existing `draftId` column becomes NULLABLE (was `NOT NULL`) — a document row now belongs to EITHER a draft (original upload, Phase 2a's existing flow, unchanged) OR a campaign (a revision re-upload, this plan's new flow), enforced by a new check constraint requiring exactly one.
- `campaign_revisions` (new): one row per field-scoped revision request. `campaignId (FK -> campaigns.id, onDelete: cascade)`, `field` enum (`cerita | target_donasi | kartu_mahasiswa | kartu_pelajar | tagihan_rumah_sakit | tagihan_institusi_pendidikan | media_sosial | sumber_gambar`), `note` (moderator's explanation, required), `status` enum (`open | resolved`, default `open`), `createdAt`, `resolvedAt (nullable)`.

New API surface:
- `apps/api/src/lib/admin.ts` (new) — `checkAdmin(user: User | null): { status: 401 | 403 } | null`.
- `apps/api/src/lib/media-s3.ts` (new) — a shared private-bucket S3 client, consolidating the config Phase 2a/2c duplicated across `campaign-drafts.ts` and `campaigns.ts` (a third near-identical instance would be the third copy; this plan's new admin code uses the shared one instead — the two existing files are left untouched, not retrofitted, to avoid re-touching already-shipped, already-reviewed code for a style cleanup alone).
- `apps/api/src/routes/admin.ts` (new file, new route group, mounted at `/admin`):
  - `GET /admin/campaigns?status=pending_review` — the moderation queue.
  - `GET /admin/campaigns/:id` — full review detail: campaign content, KYC identity + presigned document-view URLs, any open/resolved revisions.
  - `POST /admin/campaigns/:id/approve` — `pending_review -> active`, sets `publishedAt`, flips `individual_verifications.status` to `verified`, syncs the search index.
  - `POST /admin/campaigns/:id/request-revision` — `pending_review -> needs_revision`, creates one or more `campaign_revisions` rows.
- `apps/api/src/routes/campaigns.ts` (extending the existing file):
  - `GET /campaigns/:id/revisions` — campaigner's own open+resolved revision requests.
  - `PUT /campaigns/:id/story`, `PUT /campaigns/:id/goal-amount` — campaigner content edits, gated to `draft`/`needs_revision` status (same guard shape as Phase 2c's KYC identity/contact edits).
  - `POST /campaigns/:id/documents/presign`, `POST /campaigns/:id/documents/confirm` — campaign-scoped (not draft-scoped) document re-upload, for fixing a flagged document-type revision.
  - `POST /campaigns/:id/submit` (existing, modified) — on a `needs_revision -> pending_review` transition, also marks every open `campaign_revisions` row for this campaign `resolved` and sets `submittedAt`.

New web surface:
- `apps/web/src/routes/(admin)/+layout.server.ts` (new) — SSR auth + role check, replacing the Phase 0 stub's bare shell with real access control.
- `apps/web/src/routes/(admin)/dashboard/+page.svelte` (replacing the Phase 0 placeholder) — the real moderation queue.
- `apps/web/src/routes/(admin)/campaigns/[id]/+page.svelte` + `+page.server.ts` (new) — the review detail view with approve/request-revision actions.
- `apps/web/src/routes/(campaigner)/dashboard/+page.svelte` + `+page.server.ts` (new) — the first version of a campaigner "my campaigns" list, the master plan's own `/dashboard/campaigns` route, never built before this plan.
- `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/revise/+page.svelte` + `+page.server.ts` (new) — the revision-fix flow: shows open revision requests with the moderator's notes, story/goal-amount edit forms, document re-upload, and a resubmit button reusing the existing `POST /campaigns/:id/submit`.

---

### Task 1: Schema — admin role + campaign submission timestamp

**Files:**
- Modify: `packages/db/src/schema/users.ts`
- Modify: `packages/db/src/schema/campaigns.ts`
- Modify: `packages/db/src/__tests__/users.test.ts`
- Modify: `packages/db/src/__tests__/campaigns.test.ts` (only if a natural place exists to add one assertion — see Step 3)

**Interfaces:**
- Produces: `users.role` (`"campaigner" | "admin"`), `campaigns.submittedAt` (`Date | null`) — both consumed by every later task in this plan.

- [ ] **Step 1: Write the failing test — append to `packages/db/src/__tests__/users.test.ts`**

```ts
test("role defaults to campaigner, and can be set to admin", async () => {
  const [defaultRow] = await db.insert(users).values({ phone: "+6281100000003" }).returning();
  expect(defaultRow?.role).toBe("campaigner");

  const [adminRow] = await db
    .insert(users)
    .values({ phone: "+6281100000004", role: "admin" })
    .returning();
  expect(adminRow?.role).toBe("admin");
});
```

Add `"+6281100000003"` and `"+6281100000004"` to the file's existing `TEST_PHONES` array (so the `beforeAll` cleanup covers them).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/users.test.ts --env-file=../../.env`
Expected: FAIL — `role` doesn't exist on the insert shape / column doesn't exist.

- [ ] **Step 3: Implement — modify `packages/db/src/schema/users.ts`**

```ts
import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// No self-serve admin signup or invite flow exists in this phase --
// promoting a user to "admin" is a direct database UPDATE. See this
// plan's Global Constraints for why that's an intentional decision, not
// a gap.
export const userRoleEnum = pgEnum("user_role", ["campaigner", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  defaultAnonymous: boolean("default_anonymous").notNull().default(false),
  role: userRoleEnum("role").notNull().default("campaigner"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

(Only the `import` line and the new `role:` field actually change — every other field is unchanged, shown here for exact placement: right after `defaultAnonymous`, before `deletedAt`.)

Now modify `packages/db/src/schema/campaigns.ts` — add ONE field, `submittedAt`, placed right after `publishedAt`:

```ts
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Set once by POST /campaigns/:id/submit (Phase 2c, extended by this
    // plan's Task 6) -- a more precise, purpose-specific signal for the
    // admin queue's sort order than reusing updatedAt, which several
    // other writes also touch.
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/users.test.ts --env-file=../../.env`
Expected: PASS.

- [ ] **Step 5: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate` — this produces a new migration file plus the usual auto-generated `meta/*_snapshot.json`/`meta/_journal.json` updates (don't hand-edit the generated SQL). Then apply it: `cd packages/db && bun run db:migrate`.

- [ ] **Step 6: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): add users.role and campaigns.submittedAt"
```

---

### Task 2: Schema — `campaign_revisions` table

**Files:**
- Create: `packages/db/src/schema/campaign-revisions.ts`
- Modify: `packages/db/src/schema/index.ts` (barrel export)
- Test: `packages/db/src/__tests__/campaign-revisions.test.ts`

**Interfaces:**
- Consumes: `campaigns` (existing).
- Produces: `campaignRevisions` table, `campaignRevisionFieldEnum`, `campaignRevisionStatusEnum`, `CampaignRevision`/`NewCampaignRevision` types — consumed by Tasks 6, 7, 8.

- [ ] **Step 1: Write the failing test — `packages/db/src/__tests__/campaign-revisions.test.ts`**

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaignRevisions } from "../schema/campaign-revisions";
import { campaigns } from "../schema/campaigns";
import { campaigners } from "../schema/campaigners";
import { campaignCategories } from "../schema/categories";

async function seedCampaign(slug: string) {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found -- run db seed first");
  const [campaigner] = await db
    .insert(campaigners)
    .values({ type: "individual", displayName: "Test Campaigner" })
    .returning();
  if (!campaigner) throw new Error("campaigner insert failed");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug,
      title: "Test Campaign",
      shortDescription: "desc",
      categoryId: category.id,
      campaignerId: campaigner.id,
      model: "goal",
      goalAmount: 1000000n,
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  return campaign;
}

describe("campaign_revisions", () => {
  beforeAll(async () => {
    await db.delete(campaigns).where(eq(campaigns.slug, "test-campaign-revisions"));
  });

  test("a revision request is created open, with a required note", async () => {
    const campaign = await seedCampaign("test-campaign-revisions");
    const [revision] = await db
      .insert(campaignRevisions)
      .values({ campaignId: campaign.id, field: "cerita", note: "Cerita terlalu singkat." })
      .returning();
    expect(revision?.status).toBe("open");
    expect(revision?.resolvedAt).toBeNull();
    expect(revision?.note).toBe("Cerita terlalu singkat.");
  });

  test("revisions are deleted when their campaign is deleted (cascade)", async () => {
    const campaign = await seedCampaign("test-campaign-revisions-cascade");
    await db
      .insert(campaignRevisions)
      .values({ campaignId: campaign.id, field: "target_donasi", note: "Perlu penjelasan." });
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
    const remaining = await db
      .select()
      .from(campaignRevisions)
      .where(eq(campaignRevisions.campaignId, campaign.id));
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/campaign-revisions.test.ts --env-file=../../.env`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `packages/db/src/schema/campaign-revisions.ts`**

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";

// The 8 field-scoped revision types this plan supports -- the master
// plan's own revision taxonomy minus "penerima" (beneficiary/patient
// info), which has no campaign-scoped home yet; see this plan's
// "Explicitly Out of Scope" section for why. The 6 document-type values
// here reuse the EXACT string values already defined in
// campaign-documents.ts's campaignDocumentTypeEnum (minus "riwayat_medis",
// which isn't in the master plan's revision taxonomy) -- kept as a
// separate enum rather than importing that one directly, since this
// enum also needs the two non-document content fields ("cerita",
// "target_donasi") that campaign_documents has no notion of.
export const campaignRevisionFieldEnum = pgEnum("campaign_revision_field", [
  "cerita",
  "target_donasi",
  "kartu_mahasiswa",
  "kartu_pelajar",
  "tagihan_rumah_sakit",
  "tagihan_institusi_pendidikan",
  "media_sosial",
  "sumber_gambar",
]);

export const campaignRevisionStatusEnum = pgEnum("campaign_revision_status", [
  "open",
  "resolved",
]);

export const campaignRevisions = pgTable("campaign_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  field: campaignRevisionFieldEnum("field").notNull(),
  note: text("note").notNull(),
  status: campaignRevisionStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type CampaignRevision = typeof campaignRevisions.$inferSelect;
export type NewCampaignRevision = typeof campaignRevisions.$inferInsert;
```

- [ ] **Step 4: Add the barrel export — modify `packages/db/src/schema/index.ts`**

Add `export * from "./campaign-revisions";` alongside the file's existing `export * from "./..."` lines (match the existing file's alphabetical-ish ordering if it has one; otherwise append).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/campaign-revisions.test.ts --env-file=../../.env`
Expected: PASS — 2 tests.

- [ ] **Step 6: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate && bun run db:migrate`.

- [ ] **Step 7: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): add campaign_revisions table"
```

---

### Task 3: Schema — campaign-scoped document re-uploads (`campaign_documents.campaignId`)

**Files:**
- Modify: `packages/db/src/schema/campaign-documents.ts`
- Modify: `packages/db/src/__tests__/campaign-documents.test.ts`

**Interfaces:**
- Produces: `campaignDocuments.campaignId` (nullable), `campaignDocuments.draftId` now nullable too — consumed by Task 9 (campaign-scoped document presign/confirm).

- [ ] **Step 1: Read the current test file first**

Read `packages/db/src/__tests__/campaign-documents.test.ts` in full before writing the new test below — match its existing fixture/cleanup style exactly (it very likely already seeds a draft the same way this plan's Task 2 test seeds a campaign).

- [ ] **Step 2: Write the failing test — append to `packages/db/src/__tests__/campaign-documents.test.ts`**

```ts
test("a document can belong to a campaign instead of a draft (revision re-upload)", async () => {
  const campaign = await seedCampaign("test-campaign-documents-campaign-scoped");
  const [document] = await db
    .insert(campaignDocuments)
    .values({ campaignId: campaign.id, type: "media_sosial", objectKey: "campaigns/x/documents/media_sosial/y.jpg" })
    .returning();
  expect(document?.draftId).toBeNull();
  expect(document?.campaignId).toBe(campaign.id);
});

test("a document row must have exactly one owner (draft xor campaign)", async () => {
  const campaign = await seedCampaign("test-campaign-documents-exactly-one-owner");
  await expect(
    Promise.resolve(
      db.insert(campaignDocuments).values({
        campaignId: campaign.id,
        draftId: campaign.draftId ?? undefined,
        type: "media_sosial",
        objectKey: "campaigns/x/documents/media_sosial/z.jpg",
      }),
    ),
  ).rejects.toThrow();

  await expect(
    Promise.resolve(
      db.insert(campaignDocuments).values({
        type: "media_sosial",
        objectKey: "campaigns/x/documents/media_sosial/w.jpg",
      }),
    ),
  ).rejects.toThrow();
});
```

If the existing test file has no `seedCampaign`-shaped helper already (it may only ever have seeded drafts, never campaigns), write one matching Task 2's `seedCampaign` helper above, adapted to this file's existing imports.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/db && bun test src/__tests__/campaign-documents.test.ts --env-file=../../.env`
Expected: FAIL — `campaignId` doesn't exist on the insert shape, and the "exactly one owner" constraint doesn't exist yet (both inserts in that second test would currently succeed).

- [ ] **Step 4: Implement — modify `packages/db/src/schema/campaign-documents.ts`**

```ts
import { check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { campaignDrafts } from "./campaign-drafts";
import { campaigns } from "./campaigns";

export const campaignDocumentTypeEnum = pgEnum("campaign_document_type", [
  "kartu_mahasiswa",
  "kartu_pelajar",
  "tagihan_rumah_sakit",
  "tagihan_institusi_pendidikan",
  "media_sosial",
  "sumber_gambar",
  "riwayat_medis",
]);

export const campaignDocuments = pgTable(
  "campaign_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable as of this plan (Phase 3) -- was NOT NULL through Phase 2a.
    // A document row now belongs to EITHER a draft (the original upload,
    // Phase 2a's flow, unchanged) OR a campaign (a revision re-upload,
    // this plan's new flow) -- never both, never neither, enforced below.
    draftId: uuid("draft_id").references(() => campaignDrafts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    type: campaignDocumentTypeEnum("type").notNull(),
    objectKey: text("object_key").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "campaign_documents_exactly_one_owner",
      sql`(${table.draftId} IS NOT NULL AND ${table.campaignId} IS NULL) OR
          (${table.draftId} IS NULL AND ${table.campaignId} IS NOT NULL)`,
    ),
  ],
);

export type CampaignDocument = typeof campaignDocuments.$inferSelect;
export type NewCampaignDocument = typeof campaignDocuments.$inferInsert;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/db && bun test src/__tests__/campaign-documents.test.ts --env-file=../../.env`
Expected: PASS, including every pre-existing test in this file (the draft-scoped upload path is unchanged behavior, just now against a nullable column).

- [ ] **Step 6: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate && bun run db:migrate`.

- [ ] **Step 7: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): make campaign_documents own by either a draft or a campaign"
```

---

### Task 4: Contracts — admin, revision, and campaign-edit schemas

**Files:**
- Modify: `packages/contracts/src/campaigns.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `MoneyJSONSchema`, `CampaignCategorySchema`, `CampaignErrorSchema` (all existing in this file).
- Produces: every schema listed below — consumed by Tasks 5, 6, 7, 8, 9 (API) and Tasks 10-13 (web).

- [ ] **Step 1: Read the current end of the file first**

Read `packages/contracts/src/campaigns.ts` in full (it is ~152 lines) to place new exports consistently with the existing style (each schema followed immediately by its `Static<>` type alias where one is needed downstream, matching `KycStatusResponse`/`PresignKycDocumentResponse`/`SubmitCampaignResponse`'s existing pattern).

- [ ] **Step 2: Append the new schemas**

```ts
// ---- Phase 3: admin moderation ----

export const AdminCampaignListItemSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  title: Type.String(),
  campaignerName: Type.String(),
  categoryTitle: Type.String(),
  status: Type.String(),
  submittedAt: Type.Union([Type.String(), Type.Null()]),
});
export type AdminCampaignListItem = Static<typeof AdminCampaignListItemSchema>;

export const AdminCampaignListResponseSchema = Type.Object({
  campaigns: Type.Array(AdminCampaignListItemSchema),
});

export const AdminCampaignRevisionSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  field: Type.String(),
  note: Type.String(),
  status: Type.String(),
  createdAt: Type.String(),
  resolvedAt: Type.Union([Type.String(), Type.Null()]),
});
export type AdminCampaignRevision = Static<typeof AdminCampaignRevisionSchema>;

export const AdminCampaignDocumentSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: Type.String(),
  viewUrl: Type.String(),
  uploadedAt: Type.String(),
});

export const AdminCampaignDetailResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  title: Type.String(),
  shortDescription: Type.String(),
  story: Type.String(),
  status: Type.String(),
  model: Type.Union([Type.Literal("goal"), Type.Literal("program")]),
  goalAmount: Type.Union([MoneyJSONSchema, Type.Null()]),
  category: CampaignCategorySchema,
  campaignerName: Type.String(),
  verification: Type.Object({
    fullName: Type.String(),
    nationalId: Type.String(),
    dateOfBirth: Type.String(),
    address: Type.String(),
    city: Type.String(),
    postalCode: Type.String(),
    ktpViewUrl: Type.Union([Type.String(), Type.Null()]),
    selfieViewUrl: Type.Union([Type.String(), Type.Null()]),
    status: Type.String(),
  }),
  documents: Type.Array(AdminCampaignDocumentSchema),
  revisions: Type.Array(AdminCampaignRevisionSchema),
});
export type AdminCampaignDetailResponse = Static<typeof AdminCampaignDetailResponseSchema>;

export const AdminRequestRevisionFieldSchema = Type.Union([
  Type.Literal("cerita"),
  Type.Literal("target_donasi"),
  Type.Literal("kartu_mahasiswa"),
  Type.Literal("kartu_pelajar"),
  Type.Literal("tagihan_rumah_sakit"),
  Type.Literal("tagihan_institusi_pendidikan"),
  Type.Literal("media_sosial"),
  Type.Literal("sumber_gambar"),
]);

export const AdminRequestRevisionBodySchema = Type.Object({
  items: Type.Array(
    Type.Object({ field: AdminRequestRevisionFieldSchema, note: Type.String({ minLength: 1 }) }),
    { minItems: 1 },
  ),
});

export const AdminActionResponseSchema = Type.Object({ status: Type.String() });

// ---- Phase 3: campaigner-facing revisions + content edits ----

export const CampaignRevisionListResponseSchema = Type.Object({
  revisions: Type.Array(AdminCampaignRevisionSchema),
});

export const SaveCampaignStoryBodySchema = Type.Object({ story: Type.String({ minLength: 1 }) });
export const SaveCampaignGoalAmountBodySchema = Type.Object({
  goalAmountStr: Type.String({ pattern: "^\\d+$" }),
});

export const CampaignDocumentTypeSchema = Type.Union([
  Type.Literal("kartu_mahasiswa"),
  Type.Literal("kartu_pelajar"),
  Type.Literal("tagihan_rumah_sakit"),
  Type.Literal("tagihan_institusi_pendidikan"),
  Type.Literal("media_sosial"),
  Type.Literal("sumber_gambar"),
]);

export const PresignCampaignDocumentBodySchema = Type.Object({
  documentType: CampaignDocumentTypeSchema,
  fileName: Type.String({ minLength: 1 }),
});
export const PresignCampaignDocumentResponseSchema = Type.Object({
  uploadUrl: Type.String(),
  objectKey: Type.String(),
  expiresInSeconds: Type.Number(),
});
export type PresignCampaignDocumentResponse = Static<typeof PresignCampaignDocumentResponseSchema>;

export const ConfirmCampaignDocumentBodySchema = Type.Object({
  documentType: CampaignDocumentTypeSchema,
  objectKey: Type.String(),
});
```

- [ ] **Step 3: Update the barrel export — modify `packages/contracts/src/index.ts`**

Read the file first to match its exact grouping (it separates `export type { ... }` from `export { ... }` blocks). Add every NEW schema name to the `export { ... }` block, and every NEW `Static<>` type alias (`PresignCampaignDocumentResponse`, `AdminCampaignDetailResponse`, `AdminCampaignRevision`, `AdminCampaignListItem`) to the `export type { ... }` block, alphabetized consistently with the existing entries.

- [ ] **Step 4: Run the repo-wide typecheck to confirm the new file compiles**

Run: `cd <worktree root> && bun run typecheck`
Expected: `@galangdana/contracts` and every downstream package still 0 errors (nothing consumes these new exports yet, so this just confirms the file itself is syntactically/type-sound).

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add Phase 3 admin, revision, and campaign-edit schemas"
```

---

### Task 5: `apps/api/src/lib/admin.ts` + `apps/api/src/lib/media-s3.ts`

**Files:**
- Create: `apps/api/src/lib/admin.ts`
- Test: `apps/api/src/lib/admin.test.ts`
- Create: `apps/api/src/lib/media-s3.ts`

**Interfaces:**
- Consumes: `User` type from `@galangdana/db`.
- Produces: `checkAdmin(user)`, `privateDocumentsS3` — consumed by Task 6 (admin routes) and Task 9 (campaign-scoped document uploads, which also reuses this shared client).

- [ ] **Step 1: Write the failing test — `apps/api/src/lib/admin.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import type { User } from "@galangdana/db";
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && bun test src/lib/admin.test.ts --env-file=../../.env`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `apps/api/src/lib/admin.ts`**

```ts
import type { User } from "@galangdana/db";

/**
 * The admin authorization gate, checked inline at the top of every
 * /admin/* route handler -- matching this codebase's established idiom
 * (sessionDerive never rejects on its own; each handler checks `user`
 * itself). Unlike the ownership-scoped 404-not-403 pattern every other
 * endpoint in this codebase uses, admin routes are role-scoped: a 403
 * for "authenticated but not an admin" is the correct, intentional
 * signal here -- there's no reason to hide that /admin/* exists from a
 * non-admin user the way ownership-scoped routes hide a campaign's
 * existence from a non-owner.
 */
export function checkAdmin(user: User | null): { status: 401 | 403 } | null {
  if (!user) return { status: 401 };
  if (user.role !== "admin") return { status: 403 };
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && bun test src/lib/admin.test.ts --env-file=../../.env`
Expected: PASS — 3 tests.

- [ ] **Step 5: Implement `apps/api/src/lib/media-s3.ts` (no test — this is a thin config wrapper, mirroring the existing untested `documentsS3`/`kycDocumentsS3` instances it consolidates)**

```ts
/**
 * Shared private-bucket S3 client for reading/writing campaign documents
 * and KYC files. Phase 2a (`campaign-drafts.ts`) and Phase 2c
 * (`campaigns.ts`) each instantiated their own near-identical
 * Bun.S3Client for this same bucket -- this is the third instance this
 * plan needs (admin document viewing, Task 6; campaign-scoped document
 * re-upload, Task 9), so it's extracted here instead of duplicated a
 * third time. The two existing instances in campaign-drafts.ts and
 * campaigns.ts are deliberately left as-is, not retrofitted to import
 * this -- re-touching already-shipped, already-reviewed files for a
 * style cleanup alone isn't worth the regression risk in this plan.
 */
export const privateDocumentsS3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "galangdana",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "galangdana-dev-secret",
  bucket: process.env.MEDIA_S3_PRIVATE_BUCKET ?? "campaign-documents",
  region: "us-east-1",
});

export const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

export function extractDocumentExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ALLOWED_DOCUMENT_EXTENSIONS.includes(ext) ? ext : null;
}
```

- [ ] **Step 6: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add admin auth helper and shared private-documents S3 client"
```

---

### Task 6: `GET /admin/campaigns` + `GET /admin/campaigns/:id`

**Files:**
- Create: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/routes/admin.test.ts`
- Modify: `apps/api/src/index.ts` (mount the new route — read this file first to see how `campaignsRoute`/`searchRoute` etc. are currently mounted, and match exactly)

**Interfaces:**
- Consumes: `checkAdmin` (Task 5), `privateDocumentsS3` (Task 5), `AdminCampaignListResponseSchema`/`AdminCampaignDetailResponseSchema` (Task 4), `campaigns`/`campaigners`/`campaignCategories`/`individualVerifications`/`campaignDocuments`/`campaignRevisions` (Tasks 1-3).
- Produces: `GET /admin/campaigns`, `GET /admin/campaigns/:id` — consumed by Tasks 10-11 (admin web pages).

- [ ] **Step 1: Write the failing tests — `apps/api/src/routes/admin.test.ts`**

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import {
  campaignCategories,
  campaigners,
  campaigns,
  db,
  individualVerifications,
  sessions,
  users,
} from "@galangdana/db";
import { eq, inArray } from "drizzle-orm";
import { adminRoute } from "./admin";

const app = adminRoute;

// Sessions are inserted directly into the sessions table with a fixed
// token as the row id -- no real OTP/login round trip needed in a test.
// Matches the exact pattern already established in campaigns.test.ts
// (TEST_USER_ID/TEST_TOKEN inserted directly in beforeAll).
const ADMIN_USER_ID = "44444444-5555-6666-7777-888888888803";
const CAMPAIGNER_USER_ID = "44444444-5555-6666-7777-888888888804";
const ADMIN_TOKEN = "admin-test-token";
const CAMPAIGNER_TOKEN = "admin-test-campaigner-token";

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `session=${token}` } });
}

beforeAll(async () => {
  await db.delete(users).where(inArray(users.id, [ADMIN_USER_ID, CAMPAIGNER_USER_ID]));
  await db.insert(users).values([
    { id: ADMIN_USER_ID, phone: "+6281199000001", role: "admin" },
    { id: CAMPAIGNER_USER_ID, phone: "+6281199000002", role: "campaigner" },
  ]);
  await db.insert(sessions).values([
    { id: ADMIN_TOKEN, userId: ADMIN_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: CAMPAIGNER_TOKEN, userId: CAMPAIGNER_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  ]);
});

async function seedPendingCampaign() {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category -- run db seed first");
  const [campaigner] = await db
    .insert(campaigners)
    .values({ type: "individual", displayName: "Aldi Setiawan" })
    .returning();
  if (!campaigner) throw new Error("campaigner insert failed");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `admin-test-${crypto.randomUUID()}`,
      title: "Bantu Aldi Sembuh",
      shortDescription: "desc",
      categoryId: category.id,
      campaignerId: campaigner.id,
      model: "goal",
      goalAmount: 5000000n,
      status: "pending_review",
      submittedAt: new Date(),
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  await db.insert(individualVerifications).values({
    campaignId: campaign.id,
    fullName: "Aldi Setiawan",
    nationalId: "3271234567890001",
    dateOfBirth: "1990-05-12",
    address: "Jl. Merdeka No. 1",
    city: "Bandung",
    postalCode: "40111",
    ktpObjectKey: `kyc/${campaign.id}/ktp/x.jpg`,
    selfieObjectKey: `kyc/${campaign.id}/selfie/y.jpg`,
  });
  return campaign;
}

describe("GET /admin/campaigns", () => {
  test("401s for an unauthenticated request", async () => {
    const resp = await app.handle(new Request("http://localhost/admin/campaigns"));
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const token = CAMPAIGNER_TOKEN;
    const resp = await app.handle(authedRequest("http://localhost/admin/campaigns", token));
    expect(resp.status).toBe(403);
  });

  test("lists pending_review campaigns for an admin, with campaigner and category names", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(authedRequest("http://localhost/admin/campaigns", token));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { campaigns: Array<{ id: string; campaignerName: string }> };
    const found = body.campaigns.find((c) => c.id === campaign.id);
    expect(found?.campaignerName).toBe("Aldi Setiawan");
  });
});

describe("GET /admin/campaigns/:id", () => {
  test("404s for a nonexistent campaign", async () => {
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${crypto.randomUUID()}`, token),
    );
    expect(resp.status).toBe(404);
  });

  test("returns full detail including presigned, non-empty KTP/selfie view URLs", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}`, token),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      verification: { ktpViewUrl: string | null; selfieViewUrl: string | null; fullName: string };
    };
    expect(body.verification.fullName).toBe("Aldi Setiawan");
    expect(body.verification.ktpViewUrl).toMatch(/^https?:\/\//);
    expect(body.verification.selfieViewUrl).toMatch(/^https?:\/\//);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/admin.test.ts --env-file=../../.env`
Expected: FAIL — `./admin` doesn't exist.

- [ ] **Step 3: Implement `apps/api/src/routes/admin.ts`**

```ts
import {
  AdminCampaignDetailResponseSchema,
  AdminCampaignListResponseSchema,
  CampaignErrorSchema,
} from "@galangdana/contracts";
import {
  campaignCategories,
  campaignDocuments,
  campaignRevisions,
  campaigners,
  campaigns,
  db,
  individualVerifications,
} from "@galangdana/db";
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { checkAdmin } from "../lib/admin";
import { privateDocumentsS3 } from "../lib/media-s3";
import { sessionDerive } from "../lib/session";

const VIEW_URL_EXPIRY_SECONDS = 300;

export const adminRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/admin/campaigns",
    async ({ user, query, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      const status = query.status ?? "pending_review";
      const rows = await db
        .select({
          id: campaigns.id,
          slug: campaigns.slug,
          title: campaigns.title,
          status: campaigns.status,
          submittedAt: campaigns.submittedAt,
          campaignerName: campaigners.displayName,
          categoryTitle: campaignCategories.title,
        })
        .from(campaigns)
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .where(eq(campaigns.status, status))
        .orderBy(desc(campaigns.submittedAt));

      return {
        campaigns: rows.map((row) => ({
          ...row,
          submittedAt: row.submittedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      query: t.Object({ status: t.Optional(t.String()) }),
      response: { 200: AdminCampaignListResponseSchema, 401: CampaignErrorSchema, 403: CampaignErrorSchema },
    },
  )
  .get(
    "/admin/campaigns/:id",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      const [row] = await db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(eq(campaigns.id, params.id));
      if (!row) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const [verification] = await db
        .select()
        .from(individualVerifications)
        .where(eq(individualVerifications.campaignId, row.campaign.id));

      const ktpViewUrl = verification?.ktpObjectKey
        ? privateDocumentsS3
            .file(verification.ktpObjectKey)
            .presign({ method: "GET", expiresIn: VIEW_URL_EXPIRY_SECONDS })
        : null;
      const selfieViewUrl = verification?.selfieObjectKey
        ? privateDocumentsS3
            .file(verification.selfieObjectKey)
            .presign({ method: "GET", expiresIn: VIEW_URL_EXPIRY_SECONDS })
        : null;

      const documents = await db
        .select()
        .from(campaignDocuments)
        .where(eq(campaignDocuments.campaignId, row.campaign.id));

      const revisions = await db
        .select()
        .from(campaignRevisions)
        .where(eq(campaignRevisions.campaignId, row.campaign.id))
        .orderBy(desc(campaignRevisions.createdAt));

      return {
        id: row.campaign.id,
        slug: row.campaign.slug,
        title: row.campaign.title,
        shortDescription: row.campaign.shortDescription,
        story: row.campaign.story,
        status: row.campaign.status,
        model: row.campaign.model,
        goalAmount: row.campaign.goalAmount
          ? { amount: row.campaign.goalAmount.toString(), currency: row.campaign.currency }
          : null,
        category: { id: row.category.id, slug: row.category.slug, title: row.category.title },
        campaignerName: row.campaigner.displayName,
        verification: {
          fullName: verification?.fullName ?? "",
          nationalId: verification?.nationalId ?? "",
          dateOfBirth: verification?.dateOfBirth ?? "",
          address: verification?.address ?? "",
          city: verification?.city ?? "",
          postalCode: verification?.postalCode ?? "",
          ktpViewUrl,
          selfieViewUrl,
          status: verification?.status ?? "pending",
        },
        documents: documents.map((doc) => ({
          id: doc.id,
          type: doc.type,
          viewUrl: privateDocumentsS3
            .file(doc.objectKey)
            .presign({ method: "GET", expiresIn: VIEW_URL_EXPIRY_SECONDS }),
          uploadedAt: doc.uploadedAt.toISOString(),
        })),
        revisions: revisions.map((rev) => ({
          id: rev.id,
          field: rev.field,
          note: rev.note,
          status: rev.status,
          createdAt: rev.createdAt.toISOString(),
          resolvedAt: rev.resolvedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AdminCampaignDetailResponseSchema,
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
        404: CampaignErrorSchema,
      },
    },
  );
```

Note: `goalAmount.amount` is built with `.toString()` here rather than going through `moneyToJSON`/`displayAmount` (`apps/api/src/lib/campaign-response.ts`) — this admin detail view intentionally shows the RAW `goalAmount`, not the goal-vs-program `displayAmount` logic meant for public-facing pages, since a moderator needs to see exactly what was entered. Import `and` from `drizzle-orm` only if you end up needing it (the code above doesn't currently), remove it from the import line if unused — Biome will flag an unused import.

- [ ] **Step 4: Mount the new route — modify `apps/api/src/index.ts`**

Read the file first. Add the import and `.use(adminRoute)` following the exact pattern the file already uses for `campaignsRoute`/`searchRoute`/etc.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/admin.test.ts --env-file=../../.env`
Expected: PASS — 5 tests.

- [ ] **Step 6: Run the full `apps/api` suite, lint, and repo-wide typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add admin moderation queue and campaign detail endpoints"
```

---

### Task 7: `POST /admin/campaigns/:id/approve` + `POST /admin/campaigns/:id/request-revision`

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `AdminRequestRevisionBodySchema`/`AdminActionResponseSchema` (Task 4), `syncCampaignsIndex` from `@galangdana/search`.
- Produces: the two moderator actions — consumed by Task 11 (admin review page).

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/admin.test.ts`**

```ts
describe("POST /admin/campaigns/:id/approve", () => {
  test("403s for a non-admin", async () => {
    const campaign = await seedPendingCampaign();
    const token = CAMPAIGNER_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/approve`, token, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(403);
  });

  test("flips status to active, sets publishedAt, and marks KYC verified", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/approve`, token, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("active");
    expect(row?.publishedAt).not.toBeNull();

    const [verification] = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(verification?.status).toBe("verified");
  });

  test("409s when the campaign isn't pending_review", async () => {
    const campaign = await seedPendingCampaign();
    await db.update(campaigns).set({ status: "active" }).where(eq(campaigns.id, campaign.id));
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/approve`, token, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
  });
});

describe("POST /admin/campaigns/:id/request-revision", () => {
  test("flips status to needs_revision and creates open revision rows", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/request-revision`, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            { field: "cerita", note: "Cerita terlalu singkat, tambahkan detail." },
            { field: "sumber_gambar", note: "Sertakan sumber foto." },
          ],
        }),
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("needs_revision");

    const revisions = await db
      .select()
      .from(campaignRevisions)
      .where(eq(campaignRevisions.campaignId, campaign.id));
    expect(revisions).toHaveLength(2);
    expect(revisions.every((r) => r.status === "open")).toBe(true);
  });
});
```

Add `campaignRevisions` and `eq` to this test file's imports if not already present from Task 6.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/admin.test.ts --env-file=../../.env`
Expected: FAIL — the two routes don't exist.

- [ ] **Step 3: Implement both endpoints — append to `apps/api/src/routes/admin.ts`**

Add to the imports: `AdminActionResponseSchema`, `AdminRequestRevisionBodySchema` from `@galangdana/contracts`; `syncCampaignsIndex` from `@galangdana/search`; `buildImgproxyUrl` is NOT needed here (approve doesn't need the cover image). Add `.post(...)` calls, chained after the existing `.get(...)` calls in the same `new Elysia()` chain:

```ts
  .post(
    "/admin/campaigns/:id/approve",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      const [row] = await db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(eq(campaigns.id, params.id));
      if (!row) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (row.campaign.status !== "pending_review") {
        set.status = 409;
        return { error: "invalid_campaign_status" };
      }

      const now = new Date();
      await db
        .update(campaigns)
        .set({ status: "active", publishedAt: now, updatedAt: now })
        .where(eq(campaigns.id, row.campaign.id));
      await db
        .update(individualVerifications)
        .set({ status: "verified", updatedAt: now })
        .where(eq(individualVerifications.campaignId, row.campaign.id));

      await syncCampaignsIndex([
        {
          id: row.campaign.id,
          slug: row.campaign.slug,
          title: row.campaign.title,
          shortDescription: row.campaign.shortDescription,
          categoryId: row.category.id,
          categorySlug: row.category.slug,
          model: row.campaign.model,
          createdAtMs: row.campaign.createdAt.getTime(),
        },
      ]);

      return { status: "active" };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AdminActionResponseSchema,
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  )
  .post(
    "/admin/campaigns/:id/request-revision",
    async ({ user, params, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }

      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, params.id));
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "pending_review") {
        set.status = 409;
        return { error: "invalid_campaign_status" };
      }

      await db.insert(campaignRevisions).values(
        body.items.map((item) => ({
          campaignId: campaign.id,
          field: item.field,
          note: item.note,
        })),
      );
      await db
        .update(campaigns)
        .set({ status: "needs_revision", updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      return { status: "needs_revision" };
    },
    {
      params: t.Object({ id: t.String() }),
      body: AdminRequestRevisionBodySchema,
      response: {
        200: AdminActionResponseSchema,
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
        404: CampaignErrorSchema,
        409: CampaignErrorSchema,
      },
    },
  );
```

(Move the trailing `;` from the previous last call in the chain to the end of this new last call, matching the exact pattern every prior phase's route-file edits in this codebase have used.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/admin.test.ts --env-file=../../.env`
Expected: PASS — 9 tests total.

- [ ] **Step 5: Run the full `apps/api` suite, lint, repo-wide typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add admin approve and request-revision actions"
```

---

### Task 8: Extend `POST /campaigns/:id/submit` to resolve revisions and set `submittedAt`

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `campaignRevisions` (Task 2).
- Produces: the existing `POST /campaigns/:id/submit` now also sets `submittedAt` and auto-resolves open revisions — consumed by Task 13 (campaigner revision-fix page's resubmit button, which calls this SAME pre-existing endpoint, no new endpoint needed).

- [ ] **Step 1: Read the current handler first**

Read the existing `POST /campaigns/:id/submit` handler in `apps/api/src/routes/campaigns.ts` (it currently ends with `.update(campaigns).set({ status: "pending_review", updatedAt: new Date() })`) before editing — the exact surrounding lines matter for a clean diff.

- [ ] **Step 2: Write the failing test — append to `apps/api/src/routes/campaigns.test.ts`**

```ts
test("resubmitting after needs_revision sets submittedAt and resolves open revisions", async () => {
  const campaign = await createTestCampaign(TEST_TOKEN);
  await fillKycIdentityAndContact(campaign.id, TEST_TOKEN);
  await uploadKycDocuments(campaign.id, TEST_TOKEN);
  await app.handle(
    authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, { method: "POST" }),
  );

  // Simulate an admin request-revision (direct DB write -- this test
  // file has no admin auth helper, and doesn't need one just to set up
  // this scenario).
  await db.update(campaigns).set({ status: "needs_revision" }).where(eq(campaigns.id, campaign.id));
  const [openRevision] = await db
    .insert(campaignRevisions)
    .values({ campaignId: campaign.id, field: "cerita", note: "Perlu detail lebih." })
    .returning();

  const resp = await app.handle(
    authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, { method: "POST" }),
  );
  expect(resp.status).toBe(200);

  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
  expect(row?.status).toBe("pending_review");
  expect(row?.submittedAt).not.toBeNull();

  const [resolvedRevision] = await db
    .select()
    .from(campaignRevisions)
    .where(eq(campaignRevisions.id, openRevision?.id ?? ""));
  expect(resolvedRevision?.status).toBe("resolved");
  expect(resolvedRevision?.resolvedAt).not.toBeNull();
});
```

Add `campaignRevisions` to this file's existing `@galangdana/db` import line.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env`
Expected: FAIL — `submittedAt` stays `null` and the revision stays `open`.

- [ ] **Step 4: Implement — modify the existing submit handler's final update in `apps/api/src/routes/campaigns.ts`**

Find the existing block (from Phase 2c's final review fix wave):

```ts
      await db
        .update(campaigns)
        .set({ status: "pending_review", updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      return { status: "pending_review" };
```

Replace it with:

```ts
      const now = new Date();
      await db
        .update(campaigns)
        .set({ status: "pending_review", submittedAt: now, updatedAt: now })
        .where(eq(campaigns.id, campaign.id));
      await db
        .update(campaignRevisions)
        .set({ status: "resolved", resolvedAt: now })
        .where(
          and(eq(campaignRevisions.campaignId, campaign.id), eq(campaignRevisions.status, "open")),
        );

      return { status: "pending_review" };
```

Add `campaignRevisions` to this route file's existing `@galangdana/db` import line (it already imports `and`, `eq` from `drizzle-orm`, so no new import is needed there).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env`
Expected: PASS, including every pre-existing submit test (they never had open revisions to resolve, so the new `UPDATE ... WHERE status = 'open'` is a no-op for them — the query just matches zero rows).

- [ ] **Step 6: Run the full `apps/api` suite, lint, repo-wide typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): resolve open revisions and record submittedAt on (re)submit"
```

---

### Task 9: Campaigner-facing revision list + content edits (`story`, `goal-amount`)

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `findOwnedCampaign` (existing helper in this file, Phase 2a), `CampaignRevisionListResponseSchema`/`SaveCampaignStoryBodySchema`/`SaveCampaignGoalAmountBodySchema` (Task 4), `campaignRevisions` (Task 2).
- Produces: `GET /campaigns/:id/revisions`, `PUT /campaigns/:id/story`, `PUT /campaigns/:id/goal-amount` — consumed by Task 13 (campaigner revision-fix page).

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/campaigns.test.ts`**

```ts
describe("GET /campaigns/:id/revisions", () => {
  test("returns this campaign's revision requests, newest first", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db.insert(campaignRevisions).values([
      { campaignId: campaign.id, field: "cerita", note: "Pertama." },
      { campaignId: campaign.id, field: "target_donasi", note: "Kedua." },
    ]);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/revisions`, TEST_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { revisions: Array<{ field: string }> };
    expect(body.revisions).toHaveLength(2);
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/revisions`, OTHER_TOKEN),
    );
    expect(resp.status).toBe(404);
  });
});

describe("PUT /campaigns/:id/story", () => {
  test("updates the story while the campaign is needs_revision", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db.update(campaigns).set({ status: "needs_revision" }).where(eq(campaigns.id, campaign.id));
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story: "Cerita yang sudah diperbaiki dan lebih lengkap." }),
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.story).toBe("Cerita yang sudah diperbaiki dan lebih lengkap.");
  });

  test("409s once the campaign is active", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db.update(campaigns).set({ status: "active" }).where(eq(campaigns.id, campaign.id));
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story: "Percobaan mengubah cerita campaign aktif." }),
      }),
    );
    expect(resp.status).toBe(409);
  });
});

describe("PUT /campaigns/:id/goal-amount", () => {
  test("updates the goal amount as a real bigint", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/goal-amount`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalAmountStr: "25000000" }),
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.goalAmount).toBe(25000000n);
  });

  test("rejects a malformed goalAmountStr with 400, not a 500", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/goal-amount`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalAmountStr: "not-a-number" }),
      }),
    );
    expect(resp.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env`
Expected: FAIL — none of the 3 routes exist.

- [ ] **Step 3: Implement — append to `apps/api/src/routes/campaigns.ts`**

Add `CampaignRevisionListResponseSchema`, `SaveCampaignStoryBodySchema`, `SaveCampaignGoalAmountBodySchema` to this file's `@galangdana/contracts` import line, and `campaignRevisions` to the `@galangdana/db` import line (already added in Task 8 — confirm it's there, don't duplicate).

```ts
  .get(
    "/campaigns/:id/revisions",
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

      const revisions = await db
        .select()
        .from(campaignRevisions)
        .where(eq(campaignRevisions.campaignId, campaign.id))
        .orderBy(desc(campaignRevisions.createdAt));

      return {
        revisions: revisions.map((rev) => ({
          id: rev.id,
          field: rev.field,
          note: rev.note,
          status: rev.status,
          createdAt: rev.createdAt.toISOString(),
          resolvedAt: rev.resolvedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: CampaignRevisionListResponseSchema,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
      },
    },
  )
  .put(
    "/campaigns/:id/story",
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
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      await db
        .update(campaigns)
        .set({ story: body.story, updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveCampaignStoryBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
        409: CampaignErrorSchema2c,
      },
    },
  )
  .put(
    "/campaigns/:id/goal-amount",
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
      if (campaign.status !== "draft" && campaign.status !== "needs_revision") {
        set.status = 409;
        return { error: "campaign_not_editable" };
      }

      await db
        .update(campaigns)
        .set({ goalAmount: BigInt(body.goalAmountStr), updatedAt: new Date() })
        .where(eq(campaigns.id, campaign.id));

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveCampaignGoalAmountBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
        409: CampaignErrorSchema2c,
      },
    },
  );
```

Note: `SaveCampaignGoalAmountBodySchema`'s TypeBox `pattern: "^\\d+$"` on `goalAmountStr` means Elysia's own body validation rejects a non-numeric string BEFORE the handler runs, returning Elysia's standard validation-error response (a 422 by Elysia's default, not this route's own `400`) — this is why the "malformed goalAmountStr" test above expects 422, unlike Phase 2c's `POST /campaigns` (Task 5 there), which validates the SAME shape of string manually with a regex inside the handler and returns its own 400. Confirm this discrepancy by actually running the test — if Elysia's default validation-error status code is NOT 422 in this version, adjust the test's expectation to match reality rather than assuming.

(Move the trailing `;` to the end of this new last call in the chain.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env`
Expected: PASS — 6 new tests.

- [ ] **Step 5: Run the full `apps/api` suite, lint, repo-wide typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add campaigner revision list and story/goal-amount edit endpoints"
```

---

### Task 10: Campaign-scoped document re-upload (`POST /campaigns/:id/documents/presign` + `/confirm`)

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts`
- Modify: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `privateDocumentsS3`, `extractDocumentExtension` (Task 5), `PresignCampaignDocumentBodySchema`/`PresignCampaignDocumentResponseSchema`/`ConfirmCampaignDocumentBodySchema` (Task 4), `campaignDocuments` (Task 3).
- Produces: the document-fix half of the revision loop — consumed by Task 13 (campaigner revision-fix page).

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/campaigns.test.ts`**

```ts
describe("POST /campaigns/:id/documents/presign + /confirm", () => {
  test("presign -> real MinIO PUT -> confirm round-trip creates a campaign-scoped document row", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const presignResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/documents/presign`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "sumber_gambar", fileName: "sumber.jpg" }),
      }),
    );
    expect(presignResp.status).toBe(200);
    const { uploadUrl, objectKey } = (await presignResp.json()) as {
      uploadUrl: string;
      objectKey: string;
    };
    expect(objectKey).toStartWith(`campaigns/${campaign.id}/documents/sumber_gambar/`);

    const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake image bytes" });
    expect(putResp.ok).toBe(true);

    const confirmResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/documents/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "sumber_gambar", objectKey }),
      }),
    );
    expect(confirmResp.status).toBe(200);

    const [document] = await db
      .select()
      .from(campaignDocuments)
      .where(eq(campaignDocuments.campaignId, campaign.id));
    expect(document?.type).toBe("sumber_gambar");
    expect(document?.draftId).toBeNull();
  });

  test("confirm rejects an objectKey outside this campaign's own prefix", async () => {
    const campaignA = await createTestCampaign(TEST_TOKEN);
    const campaignB = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaignA.id}/documents/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentType: "sumber_gambar",
          objectKey: `campaigns/${campaignB.id}/documents/sumber_gambar/x.jpg`,
        }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("404s (not 403) presign for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/documents/presign`, OTHER_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "sumber_gambar", fileName: "x.jpg" }),
      }),
    );
    expect(resp.status).toBe(404);
  });
});
```

Add `campaignDocuments` to this file's existing `@galangdana/db` import line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env`
Expected: FAIL — the two routes don't exist.

- [ ] **Step 3: Implement — append to `apps/api/src/routes/campaigns.ts`**

Add `PresignCampaignDocumentBodySchema`, `PresignCampaignDocumentResponseSchema`, `ConfirmCampaignDocumentBodySchema` to the `@galangdana/contracts` import line, and `privateDocumentsS3`, `extractDocumentExtension` from `"../lib/media-s3"` as a new import.

```ts
  .post(
    "/campaigns/:id/documents/presign",
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

      const ext = extractDocumentExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }

      const objectKey = `campaigns/${campaign.id}/documents/${body.documentType}/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = privateDocumentsS3
        .file(objectKey)
        .presign({ method: "PUT", expiresIn: expiresInSeconds });

      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String() }),
      body: PresignCampaignDocumentBodySchema,
      response: {
        200: PresignCampaignDocumentResponseSchema,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
        422: CampaignErrorSchema2c,
      },
    },
  )
  .post(
    "/campaigns/:id/documents/confirm",
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

      if (!body.objectKey.startsWith(`campaigns/${campaign.id}/documents/${body.documentType}/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }

      await db
        .insert(campaignDocuments)
        .values({ campaignId: campaign.id, type: body.documentType, objectKey: body.objectKey });

      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: ConfirmCampaignDocumentBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        400: CampaignErrorSchema2c,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
      },
    },
  );
```

(Move the trailing `;` to the end of this new last call in the chain.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env`
Expected: PASS — 3 new tests.

- [ ] **Step 5: Run the full `apps/api` suite, lint, repo-wide typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add campaign-scoped document re-upload for revisions"
```

---

### Task 11: Admin dashboard — real moderation queue

**Files:**
- Modify: `apps/web/src/routes/(admin)/+layout.svelte` (verify only — should need no change, confirm in Step 1)
- Create: `apps/web/src/routes/(admin)/+layout.server.ts`
- Modify: `apps/web/src/routes/(admin)/dashboard/+page.svelte` (replacing the Phase 0 stub)
- Create: `apps/web/src/routes/(admin)/dashboard/+page.server.ts`
- Modify: `apps/web/src/routes/(admin)/dashboard/page.render.test.ts`

**Interfaces:**
- Consumes: `createServerApiClient` (existing), `GET /admin/campaigns` (Task 6).
- Produces: the real admin queue — consumed by Task 12 (admin review page's "back to queue" link).

- [ ] **Step 1: Read the existing files first**

Read `apps/web/src/routes/(admin)/+layout.svelte` and `apps/web/src/routes/(admin)/dashboard/page.render.test.ts` in full — the layout should need NO changes (it already renders `AdminShell` around `{@render children()}`); only a NEW `+layout.server.ts` (auth) is added alongside it. The existing test file currently just asserts the stub's placeholder text — it will be REPLACED, not appended to, since the whole page is changing.

- [ ] **Step 2: Write the failing tests — replace `apps/web/src/routes/(admin)/dashboard/page.render.test.ts` entirely**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const QUEUE = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "bantu-aldi-sembuh",
    title: "Bantu Aldi Sembuh",
    campaignerName: "Aldi Setiawan",
    categoryTitle: "Bantuan Medis",
    status: "pending_review",
    submittedAt: "2026-09-02T00:00:00.000Z",
  },
];

describe("admin dashboard rendering", () => {
  test("lists queued campaigns with campaigner and category names", () => {
    render(Page, { props: { data: { campaigns: QUEUE } } });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Aldi Setiawan")).not.toBeNull();
    expect(screen.getByText("Bantuan Medis")).not.toBeNull();
  });

  test("shows an empty-queue message when there is nothing to review", () => {
    render(Page, { props: { data: { campaigns: [] } } });
    expect(screen.getByText(/tidak ada campaign/i)).not.toBeNull();
  });

  test("links each row to its review detail page", () => {
    render(Page, { props: { data: { campaigns: QUEUE } } });
    const link = screen.getByRole("link", { name: /Bantu Aldi Sembuh/ });
    expect(link.getAttribute("href")).toBe(`/campaigns/${QUEUE[0]?.id}`);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/dashboard/page.render.test.ts"`
Expected: FAIL — the stub page has none of this content.

- [ ] **Step 4: Implement the layout's server load — `apps/web/src/routes/(admin)/+layout.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  // Read unconditionally, before the redirect branches -- see this
  // plan's Global Constraint (the uses.url-tracking fix carried forward
  // from Phase 2c's KYC layout).
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { error: apiError } = await client.admin.campaigns.get({ query: {} });
  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError?.status === 403) {
    redirect(303, "/");
  }

  return {};
};
```

This layout load exists PURELY to gate access (redirect a non-admin away before any admin page renders) — it deliberately makes the SAME `GET /admin/campaigns` call the dashboard page itself will make a second time via its own `+page.server.ts` (Step 5), rather than trying to share one response across a layout and a page load (SvelteKit's `depends`/`parent()` machinery for that is more complexity than this gate needs, and a redundant read-only GET is cheap). If `bun run typecheck` reports an Eden Treaty error on `client.admin.campaigns.get(...)` (a merged-intersection error, matching this plan's Global Constraint on the recurring Eden gotcha), apply the established two-part cast fix there.

- [ ] **Step 5: Implement the dashboard's own server load — `apps/web/src/routes/(admin)/dashboard/+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client.admin.campaigns.get({ query: {} });
  if (apiError || !data) {
    error(500, "Gagal memuat antrian moderasi");
  }
  return { campaigns: data.campaigns };
};
```

- [ ] **Step 6: Implement the dashboard page — replace `apps/web/src/routes/(admin)/dashboard/+page.svelte`**

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

{#if data.campaigns.length === 0}
  <p class="font-sans text-neutral-600">Tidak ada campaign yang menunggu peninjauan.</p>
{:else}
  <table class="w-full font-sans text-sm">
    <thead>
      <tr class="border-b border-neutral-200 text-left text-neutral-600">
        <th class="py-2 pr-4">Judul</th>
        <th class="py-2 pr-4">Penggalang</th>
        <th class="py-2 pr-4">Kategori</th>
        <th class="py-2 pr-4">Diajukan</th>
      </tr>
    </thead>
    <tbody>
      {#each data.campaigns as campaign (campaign.id)}
        <tr class="border-b border-neutral-100">
          <td class="py-2 pr-4">
            <a href="/campaigns/{campaign.id}" class="font-medium text-primary hover:underline">
              {campaign.title}
            </a>
          </td>
          <td class="py-2 pr-4 text-neutral-700">{campaign.campaignerName}</td>
          <td class="py-2 pr-4 text-neutral-700">{campaign.categoryTitle}</td>
          <td class="py-2 pr-4 text-neutral-500">
            {campaign.submittedAt ? new Date(campaign.submittedAt).toLocaleDateString("id-ID") : "-"}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
```

Note the review-detail link is `/campaigns/{id}`, not `/dashboard/campaigns/{id}` — this deliberately matches Task 12's route path (`apps/web/src/routes/(admin)/campaigns/[id]/+page.svelte`, a sibling of `dashboard/`, not nested under it) — see Task 12 for why.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/dashboard/page.render.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 8: Manually verify the redirect-when-unauthenticated and redirect-when-non-admin paths**

With `apps/api` and `apps/web` running locally: `curl -i http://localhost:5173/dashboard` (no cookie, admin route group) — expect a `303` redirect to `/login?redirectTo=...`. With a real non-admin session cookie, expect a `303` redirect to `/`. Report actual output; if a live stack isn't practical in this environment, substitute by re-running `cd apps/api && bun test src/routes/admin.test.ts --env-file=../../.env` as confirmation the underlying 401/403 behavior this redirect logic depends on is correct, and clearly disclose the substitution.

- [ ] **Step 9: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): add real admin moderation queue"
```

---

### Task 12: Admin campaign review/detail page

**Files:**
- Create: `apps/web/src/routes/(admin)/campaigns/[id]/+page.svelte`
- Create: `apps/web/src/routes/(admin)/campaigns/[id]/+page.server.ts`
- Test: `apps/web/src/routes/(admin)/campaigns/[id]/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /admin/campaigns/:id`, `POST /admin/campaigns/:id/approve`, `POST /admin/campaigns/:id/request-revision` (Tasks 6-7).
- Produces: the moderator's review + decision UI.

This route lives at `(admin)/campaigns/[id]/`, a SIBLING of `(admin)/dashboard/`, not nested under it (`(admin)/dashboard/campaigns/[id]/`) — deliberately, to avoid a route-path collision with Task 13's CAMPAIGNER-facing `(campaigner)/dashboard/campaigns/[id]/revise/` (different route GROUP, so no actual SvelteKit conflict either way, but keeping the admin review page's URL short and distinct — `/campaigns/[id]` — reads more like "the thing being reviewed" than "a sub-page of the admin's own dashboard").

- [ ] **Step 1: Write the failing tests — `apps/web/src/routes/(admin)/campaigns/[id]/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const DETAIL = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "bantu-aldi-sembuh",
  title: "Bantu Aldi Sembuh",
  shortDescription: "Butuh biaya operasi.",
  story: "Cerita lengkap di sini.",
  status: "pending_review",
  model: "goal" as const,
  goalAmount: { amount: "5000000", currency: "IDR" as const },
  category: { id: 1, slug: "bantuan-medis", title: "Bantuan Medis" },
  campaignerName: "Aldi Setiawan",
  verification: {
    fullName: "Aldi Setiawan",
    nationalId: "3271234567890001",
    dateOfBirth: "1990-05-12",
    address: "Jl. Merdeka No. 1",
    city: "Bandung",
    postalCode: "40111",
    ktpViewUrl: "http://localhost:9000/campaign-documents/kyc/x/ktp/y.jpg?signed=1",
    selfieViewUrl: "http://localhost:9000/campaign-documents/kyc/x/selfie/z.jpg?signed=1",
    status: "pending",
  },
  documents: [],
  revisions: [],
};

describe("admin campaign review page", () => {
  test("shows campaign content and KYC identity fields", () => {
    render(Page, { props: { data: { campaign: DETAIL }, params: { id: DETAIL.id } } });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("3271234567890001")).not.toBeNull();
    expect(screen.getByText("Aldi Setiawan")).not.toBeNull();
  });

  test("clicking Setujui approves and navigates back to the queue", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "active" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    render(Page, { props: { data: { campaign: DETAIL }, params: { id: DETAIL.id } } });
    await fireEvent.click(screen.getByRole("button", { name: "Setujui" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith("/dashboard");
    fetchSpy.mockRestore();
  });

  test("submitting a revision request with a note calls the request-revision action", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "needs_revision" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    render(Page, { props: { data: { campaign: DETAIL }, params: { id: DETAIL.id } } });
    await fireEvent.click(screen.getByLabelText("Cerita"));
    await fireEvent.input(screen.getByLabelText("Catatan untuk Cerita"), {
      target: { value: "Cerita terlalu singkat." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Minta Revisi" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith("/dashboard");
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/campaigns/[id]/page.render.test.ts"`
Expected: FAIL — the component doesn't exist.

- [ ] **Step 3: Implement the server load — `apps/web/src/routes/(admin)/campaigns/[id]/+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client.admin.campaigns({ id: params.id }).get();
  if (apiError?.status === 404 || !data) {
    error(404, "Campaign tidak ditemukan");
  }
  return { campaign: data };
};
```

If `bun run typecheck` reports an Eden Treaty merged-intersection error on `client.admin.campaigns({ id: params.id }).get()`, apply the established two-part cast fix from this plan's Global Constraints (this route's `:id` shares a path depth with Task 6's `GET /admin/campaigns/:id` and `POST .../approve`/`request-revision` — all `:id`-named, so a collision here is less likely than the `/campaigns/:slug`-vs-`:id` cases Phase 2c hit, but verify by actually running the repo-wide typecheck rather than assuming either way).

- [ ] **Step 4: Implement the review page — `apps/web/src/routes/(admin)/campaigns/[id]/+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const REVISION_FIELDS = [
  { key: "cerita", label: "Cerita" },
  { key: "target_donasi", label: "Target Donasi" },
  { key: "kartu_mahasiswa", label: "Kartu Mahasiswa" },
  { key: "kartu_pelajar", label: "Kartu Pelajar" },
  { key: "tagihan_rumah_sakit", label: "Tagihan Rumah Sakit" },
  { key: "tagihan_institusi_pendidikan", label: "Tagihan Institusi Pendidikan" },
  { key: "media_sosial", label: "Media Sosial" },
  { key: "sumber_gambar", label: "Sumber Gambar" },
] as const;

let selectedFields = $state<Set<string>>(new Set());
let notes = $state<Record<string, string>>({});
let submitting = $state(false);
let error = $state<string | null>(null);

function toggleField(key: string) {
  const next = new Set(selectedFields);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedFields = next;
}

async function approve() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.admin.campaigns({ id: data.campaign.id }).approve.post();
  submitting = false;
  if (apiError) {
    error = "Gagal menyetujui campaign.";
    return;
  }
  await goto("/dashboard");
}

async function requestRevision() {
  error = null;
  const items = Array.from(selectedFields)
    .map((field) => ({ field, note: notes[field]?.trim() ?? "" }))
    .filter((item) => item.note.length > 0);
  if (items.length === 0) {
    error = "Pilih minimal satu bagian dan tulis catatan revisi.";
    return;
  }
  submitting = true;
  // Bracket notation, not dot notation: "request-revision" is a
  // hyphenated route segment, and Eden Treaty does NOT auto-camelCase a
  // kebab-case path segment (see this plan's Global Constraint on the
  // Eden Treaty kebab-case gotcha).
  const { error: apiError } = await api
    .admin.campaigns({ id: data.campaign.id })
    ["request-revision"].post({ items });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim permintaan revisi.";
    return;
  }
  await goto("/dashboard");
}
</script>

<div class="max-w-3xl">
  <h2 class="mb-1 font-sans text-xl font-semibold text-neutral-900">{data.campaign.title}</h2>
  <p class="mb-6 font-sans text-sm text-neutral-500">
    {data.campaign.campaignerName} &middot; {data.campaign.category.title}
  </p>

  {#if error}
    <p class="mb-4 font-sans text-sm text-error">{error}</p>
  {/if}

  <section class="mb-6">
    <h3 class="mb-2 font-sans text-sm font-semibold text-neutral-900">Cerita</h3>
    <p class="whitespace-pre-line font-sans text-sm text-neutral-700">{data.campaign.story}</p>
  </section>

  <section class="mb-6">
    <h3 class="mb-2 font-sans text-sm font-semibold text-neutral-900">Data KYC</h3>
    <dl class="grid grid-cols-2 gap-2 font-sans text-sm">
      <dt class="text-neutral-500">Nama Lengkap</dt>
      <dd class="text-neutral-900">{data.campaign.verification.fullName}</dd>
      <dt class="text-neutral-500">NIK</dt>
      <dd class="text-neutral-900">{data.campaign.verification.nationalId}</dd>
      <dt class="text-neutral-500">Tanggal Lahir</dt>
      <dd class="text-neutral-900">{data.campaign.verification.dateOfBirth}</dd>
      <dt class="text-neutral-500">Alamat</dt>
      <dd class="text-neutral-900">
        {data.campaign.verification.address}, {data.campaign.verification.city}
        {data.campaign.verification.postalCode}
      </dd>
    </dl>
    <div class="mt-4 flex gap-4">
      {#if data.campaign.verification.ktpViewUrl}
        <a
          href={data.campaign.verification.ktpViewUrl}
          target="_blank"
          rel="noreferrer"
          class="font-sans text-sm text-primary hover:underline"
        >
          Lihat KTP
        </a>
      {/if}
      {#if data.campaign.verification.selfieViewUrl}
        <a
          href={data.campaign.verification.selfieViewUrl}
          target="_blank"
          rel="noreferrer"
          class="font-sans text-sm text-primary hover:underline"
        >
          Lihat Selfie
        </a>
      {/if}
    </div>
  </section>

  <section class="mb-6 rounded-sm border border-neutral-200 p-4">
    <h3 class="mb-3 font-sans text-sm font-semibold text-neutral-900">Minta Revisi</h3>
    {#each REVISION_FIELDS as revisionField (revisionField.key)}
      <div class="mb-3">
        <label class="flex items-center gap-2 font-sans text-sm">
          <input
            type="checkbox"
            id="revision-{revisionField.key}"
            checked={selectedFields.has(revisionField.key)}
            onchange={() => toggleField(revisionField.key)}
          />
          {revisionField.label}
        </label>
        {#if selectedFields.has(revisionField.key)}
          <label for="note-{revisionField.key}" class="sr-only">Catatan untuk {revisionField.label}</label>
          <textarea
            id="note-{revisionField.key}"
            rows="2"
            class="mt-1 w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
            oninput={(e) => {
              notes = { ...notes, [revisionField.key]: (e.currentTarget as HTMLTextAreaElement).value };
            }}
          ></textarea>
        {/if}
      </div>
    {/each}
    <button
      type="button"
      onclick={requestRevision}
      disabled={submitting}
      class="rounded-sm border border-primary px-4 py-2 font-sans text-sm font-semibold text-primary disabled:opacity-50"
    >
      Minta Revisi
    </button>
  </section>

  <button
    type="button"
    onclick={approve}
    disabled={submitting}
    class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
  >
    Setujui
  </button>
</div>
```

The `<label for="note-{revisionField.key}">` associated with `id="note-{revisionField.key}"` gives `screen.getByLabelText("Catatan untuk Cerita")` in the test above a real accessible name — verify this resolves correctly when you run the test; if Testing Library can't find it via `getByLabelText` because the `sr-only` label and the `id` don't line up exactly as written, fix the markup, not the test.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/campaigns/[id]/page.render.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 6: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add admin campaign review page with approve/request-revision"
```

---

### Task 13: Campaigner dashboard (first version)

**Files:**
- Create: `apps/web/src/routes/(campaigner)/dashboard/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/dashboard/+page.server.ts`
- Test: `apps/web/src/routes/(campaigner)/dashboard/page.render.test.ts`

**Interfaces:**
- Consumes: `createServerApiClient`, a NEW `GET /campaigns/mine` endpoint — see Step 3 below (this task needs one small additive backend endpoint the earlier API tasks didn't anticipate; it's folded into this task rather than split into its own since it's a single simple query with no new schema or contract complexity beyond one list-response schema, matching this plan's own "fold small same-shape work into the task that needs it" judgment call).
- Produces: the master plan's own `/dashboard/campaigns` route, built for the first time — consumed by Task 14 (links into the revision-fix flow for any `needs_revision` campaign).

- [ ] **Step 1: Add the one supporting backend piece this task needs — modify `apps/api/src/routes/campaigns.ts` and `apps/api/src/routes/campaigns.test.ts`**

Append to `packages/contracts/src/campaigns.ts` first (a small addition to Task 4's work, made here since this task is what surfaces the need for it):

```ts
export const MyCampaignsResponseSchema = Type.Object({
  campaigns: Type.Array(
    Type.Object({
      id: Type.String({ format: "uuid" }),
      slug: Type.String(),
      title: Type.String(),
      status: Type.String(),
    }),
  ),
});
```

Re-export it from `packages/contracts/src/index.ts` alongside the rest of Task 4's additions.

Write the failing test — append to `apps/api/src/routes/campaigns.test.ts`:

```ts
describe("GET /campaigns/mine", () => {
  test("lists only the caller's own campaigns, any status", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db.update(campaigns).set({ status: "needs_revision" }).where(eq(campaigns.id, campaign.id));
    const resp = await app.handle(authedRequest("http://localhost/campaigns/mine", TEST_TOKEN));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { campaigns: Array<{ id: string; status: string }> };
    expect(body.campaigns.some((c) => c.id === campaign.id && c.status === "needs_revision")).toBe(
      true,
    );
  });

  test("401s for an unauthenticated request", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns/mine"));
    expect(resp.status).toBe(401);
  });
});
```

Run: `cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env` — expect FAIL.

Implement — append to `apps/api/src/routes/campaigns.ts` (add `MyCampaignsResponseSchema` to the contracts import line):

```ts
  .get(
    "/campaigns/mine",
    async ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const [campaigner] = await db
        .select({ id: campaigners.id })
        .from(campaigners)
        .where(eq(campaigners.userId, user.id));
      if (!campaigner) {
        return { campaigns: [] };
      }

      const rows = await db
        .select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title, status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.campaignerId, campaigner.id));

      return { campaigns: rows };
    },
    { response: { 200: MyCampaignsResponseSchema, 401: CampaignErrorSchema2c } },
  );
```

(Move the trailing `;` accordingly.) Run the test again to confirm PASS, then `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck` — all clean. Commit this piece separately before moving to the frontend:

```bash
git add apps/api packages/contracts
git commit -m "feat(api): add GET /campaigns/mine for the campaigner dashboard"
```

- [ ] **Step 2: Write the failing frontend tests — `apps/web/src/routes/(campaigner)/dashboard/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

describe("campaigner dashboard rendering", () => {
  test("shows each campaign with a status badge", () => {
    render(Page, {
      props: {
        data: {
          campaigns: [
            { id: "1", slug: "bantu-aldi-sembuh", title: "Bantu Aldi Sembuh", status: "pending_review" },
            { id: "2", slug: "renovasi-masjid", title: "Renovasi Masjid", status: "needs_revision" },
          ],
        },
      },
    });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Renovasi Masjid")).not.toBeNull();
  });

  test("links a needs_revision campaign to its revision-fix page", () => {
    render(Page, {
      props: {
        data: {
          campaigns: [
            { id: "2", slug: "renovasi-masjid", title: "Renovasi Masjid", status: "needs_revision" },
          ],
        },
      },
    });
    const link = screen.getByRole("link", { name: /Perbaiki/ });
    expect(link.getAttribute("href")).toBe("/dashboard/campaigns/2/revise");
  });

  test("shows an empty-state message with no campaigns yet", () => {
    render(Page, { props: { data: { campaigns: [] } } });
    expect(screen.getByText(/belum punya campaign/i)).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/dashboard/page.render.test.ts"`
Expected: FAIL — the route doesn't exist.

- [ ] **Step 4: Implement the server load — `apps/web/src/routes/(campaigner)/dashboard/+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client.campaigns.mine.get();
  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  return { campaigns: data?.campaigns ?? [] };
};
```

- [ ] **Step 5: Implement the page — `apps/web/src/routes/(campaigner)/dashboard/+page.svelte`**

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  pending_review: "Menunggu Peninjauan",
  needs_revision: "Perlu Revisi",
  active: "Aktif",
  paused: "Dijeda",
  completed: "Selesai",
  rejected: "Ditolak",
};
</script>

<div class="mx-auto max-w-2xl px-4 py-6">
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Campaign Saya</h2>

  {#if data.campaigns.length === 0}
    <p class="font-sans text-sm text-neutral-600">Anda belum punya campaign.</p>
  {:else}
    <ul class="space-y-3">
      {#each data.campaigns as campaign (campaign.id)}
        <li class="flex items-center justify-between rounded-sm border border-neutral-200 p-4">
          <div>
            <p class="font-sans text-sm font-medium text-neutral-900">{campaign.title}</p>
            <p class="font-sans text-xs text-neutral-500">
              {STATUS_LABELS[campaign.status] ?? campaign.status}
            </p>
          </div>
          {#if campaign.status === "needs_revision"}
            <a
              href="/dashboard/campaigns/{campaign.id}/revise"
              class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-primary-dark"
            >
              Perbaiki
            </a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/dashboard/page.render.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 7: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): add campaigner dashboard listing my campaigns"
```

---

### Task 14: Campaigner revision-fix page

**Files:**
- Create: `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/revise/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/revise/+page.server.ts`
- Test: `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/revise/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /campaigns/:id/revisions` (Task 9), `PUT /campaigns/:id/story` + `/goal-amount` (Task 9), `POST /campaigns/:id/documents/presign` + `/confirm` (Task 10), `POST /campaigns/:id/submit` (Task 8, existing endpoint reused as-is).
- Produces: the resubmission half of the loop this whole plan exists to close.

- [ ] **Step 1: Write the failing tests — `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/revise/page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const REVISIONS = [
  {
    id: "r1",
    field: "cerita",
    note: "Cerita terlalu singkat, tambahkan detail.",
    status: "open",
    createdAt: "2026-09-02T00:00:00.000Z",
    resolvedAt: null,
  },
];

describe("campaigner revision-fix page", () => {
  test("shows each open revision request with the moderator's note", () => {
    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" } },
    });
    expect(screen.getByText("Cerita terlalu singkat, tambahkan detail.")).not.toBeNull();
  });

  test("saving a fixed story calls the story endpoint", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" } },
    });
    await fireEvent.input(screen.getByLabelText("Cerita baru"), {
      target: { value: "Cerita yang sudah lebih lengkap dan jelas." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Simpan Cerita" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("clicking Ajukan Ulang resubmits and navigates to the dashboard", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_review" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" } },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Ajukan Ulang" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith("/dashboard");
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/dashboard/campaigns/[id]/revise/page.render.test.ts"`
Expected: FAIL — the route doesn't exist.

- [ ] **Step 3: Implement the server load — `.../revise/+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies, url }) => {
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client.campaigns({ id: params.id }).revisions.get();
  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError?.status === 404 || !data) {
    error(404, "Campaign tidak ditemukan");
  }

  return { campaignId: params.id, revisions: data.revisions.filter((r) => r.status === "open") };
};
```

If `bun run typecheck` reports an Eden Treaty merged-intersection error on `client.campaigns({ id: params.id }).revisions.get()`, apply the established two-part cast fix — this shares the `/campaigns/:id/...` depth with Phase 2c's KYC routes and this plan's own `/campaigns/:id/story`/`/goal-amount`/`/documents/*` routes, all `:id`-named, so a collision is unlikely but must be VERIFIED via the actual repo-wide typecheck output, not assumed either way.

- [ ] **Step 4: Implement the page — `.../revise/+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const FIELD_LABELS: Record<string, string> = {
  cerita: "Cerita",
  target_donasi: "Target Donasi",
  kartu_mahasiswa: "Kartu Mahasiswa",
  kartu_pelajar: "Kartu Pelajar",
  tagihan_rumah_sakit: "Tagihan Rumah Sakit",
  tagihan_institusi_pendidikan: "Tagihan Institusi Pendidikan",
  media_sosial: "Media Sosial",
  sumber_gambar: "Sumber Gambar",
};

const DOCUMENT_FIELDS = new Set([
  "kartu_mahasiswa",
  "kartu_pelajar",
  "tagihan_rumah_sakit",
  "tagihan_institusi_pendidikan",
  "media_sosial",
  "sumber_gambar",
]);

let storyValue = $state("");
let goalAmountValue = $state("");
let saving = $state<string | null>(null);
let submitting = $state(false);
let error = $state<string | null>(null);
let selectedFile = $state<File | null>(null);

async function saveStory() {
  if (!storyValue.trim()) return;
  saving = "cerita";
  error = null;
  const { error: apiError } = await api.campaigns({ id: data.campaignId }).story.put({ story: storyValue });
  saving = null;
  if (apiError) error = "Gagal menyimpan cerita.";
}

async function saveGoalAmount() {
  if (!/^\d+$/.test(goalAmountValue)) {
    error = "Masukkan angka target donasi yang valid.";
    return;
  }
  saving = "target_donasi";
  error = null;
  const { error: apiError } = await api
    .campaigns({ id: data.campaignId })
    ["goal-amount"].put({ goalAmountStr: goalAmountValue });
  saving = null;
  if (apiError) error = "Gagal menyimpan target donasi.";
}

async function uploadDocument(documentType: string) {
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  saving = documentType;
  error = null;

  const { data: presign, error: presignError } = await api
    .campaigns({ id: data.campaignId })
    .documents.presign.post({ documentType, fileName: selectedFile.name });
  if (presignError || !presign) {
    saving = null;
    error = "Gagal menyiapkan unggahan.";
    return;
  }

  const putResp = await fetch(presign.uploadUrl, { method: "PUT", body: selectedFile });
  if (!putResp.ok) {
    saving = null;
    error = "Gagal mengunggah file.";
    return;
  }

  const { error: confirmError } = await api
    .campaigns({ id: data.campaignId })
    .documents.confirm.post({ documentType, objectKey: presign.objectKey });
  saving = null;
  if (confirmError) {
    error = "Gagal menyimpan dokumen.";
    return;
  }
  selectedFile = null;
}

async function resubmit() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.campaigns({ id: data.campaignId }).submit.post();
  submitting = false;
  if (apiError) {
    error = "Gagal mengajukan ulang campaign.";
    return;
  }
  await goto("/dashboard");
}
</script>

<div class="mx-auto max-w-2xl px-4 py-6">
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Perbaiki Campaign</h2>

  {#if error}
    <p class="mb-4 font-sans text-sm text-error">{error}</p>
  {/if}

  {#each data.revisions as revision (revision.id)}
    <div class="mb-6 rounded-sm border border-neutral-200 p-4">
      <h3 class="mb-1 font-sans text-sm font-semibold text-neutral-900">
        {FIELD_LABELS[revision.field] ?? revision.field}
      </h3>
      <p class="mb-3 font-sans text-sm text-neutral-600">{revision.note}</p>

      {#if revision.field === "cerita"}
        <label for="story-input" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
          Cerita baru
        </label>
        <textarea
          id="story-input"
          rows="4"
          class="mb-2 w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
          bind:value={storyValue}
        ></textarea>
        <button
          type="button"
          onclick={saveStory}
          disabled={saving === "cerita"}
          class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white disabled:opacity-50"
        >
          Simpan Cerita
        </button>
      {:else if revision.field === "target_donasi"}
        <label for="goal-input" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
          Target donasi baru (Rp)
        </label>
        <input
          id="goal-input"
          type="text"
          inputmode="numeric"
          class="mb-2 w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
          bind:value={goalAmountValue}
        />
        <button
          type="button"
          onclick={saveGoalAmount}
          disabled={saving === "target_donasi"}
          class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white disabled:opacity-50"
        >
          Simpan Target
        </button>
      {:else if DOCUMENT_FIELDS.has(revision.field)}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onchange={(e) => (selectedFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
        />
        <button
          type="button"
          onclick={() => uploadDocument(revision.field)}
          disabled={saving === revision.field}
          class="ml-2 rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white disabled:opacity-50"
        >
          Unggah
        </button>
      {/if}
    </div>
  {/each}

  <button
    type="button"
    onclick={resubmit}
    disabled={submitting}
    class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
  >
    Ajukan Ulang
  </button>
</div>
```

Note the bracket-notation call `["goal-amount"].put(...)` — matches this project's established Eden Treaty kebab-case gotcha (a route segment containing a hyphen needs bracket notation, not dot notation; `story` has no hyphen so plain dot notation is correct there). Verify this compiles under the repo-wide typecheck; if Eden's actual generated client property name for a `/goal-amount` path segment differs from a literal `"goal-amount"` string (e.g. it might camelCase to `goalAmount` instead), adjust to match reality — do not assume without checking against the real generated `App` type.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && bun x vitest run "src/routes/(campaigner)/dashboard/campaigns/[id]/revise/page.render.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 6: Manually verify one full end-to-end revision loop**

With `apps/api` and `apps/web` running locally, and a real session cookie: submit a real campaign to `pending_review`, use a directly-inserted admin user to call `POST /admin/campaigns/:id/request-revision` with a `cerita` item, confirm the campaigner dashboard shows "Perbaiki", follow it to the revise page, save a new story via the real UI, click "Ajukan Ulang", and confirm `GET /admin/campaigns?status=pending_review` shows the campaign again. If a live dual-server stack isn't practical in this environment, substitute by re-running the FULL `apps/api` test suite (`cd apps/api && bun test --env-file=../../.env`) as confirmation every endpoint this flow depends on is individually correct, and clearly disclose the substitution.

- [ ] **Step 7: Run the full `apps/web` suite, lint, typecheck, and a real build**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): add campaigner revision-fix and resubmit flow"
```

---

## Verification

- **Unit** (`bun test` across `packages/db`, `apps/api`; `vitest` across `apps/web`): every new schema, route, and component has a real test asserting actual behavior against real infrastructure (real Postgres, real MinIO presigned uploads) — no mocking of the database or storage layer, matching every earlier phase's established testing philosophy.
- **Two authorization models, both verified explicitly**: every campaigner-facing endpoint added in this plan has a dedicated non-owner-gets-404 test (Tasks 9-10); every admin endpoint has a dedicated non-admin-gets-403 and unauthenticated-gets-401 test (Tasks 6-7).
- **State machine correctness**: approve only succeeds from `pending_review` (409 otherwise, Task 7); request-revision only succeeds from `pending_review` (409 otherwise, Task 7); story/goal-amount edits only succeed from `draft`/`needs_revision` (409 otherwise, Task 9) — mirroring the exact guard shape Phase 2c's final review established for KYC field edits.
- **The resubmit loop closes for real**: Task 8's test directly verifies that a resubmit after `needs_revision` both sets `submittedAt` and flips the specific open `campaign_revisions` row to `resolved` — not just that the campaign's own status changes.
- **Security**: the campaign-scoped document objectKey is always server-generated, never client-supplied (Task 10, mirroring Phase 2a/2c's already-verified pattern); the confirm step rejects an objectKey outside the requesting campaign's own prefix. Presigned document VIEW urls (Task 6, the first read-side presign in this codebase) are built server-side from a stored objectKey only, never from a client-supplied path.
- **Money**: the goal-amount revision endpoint (Task 9) parses `goalAmountStr` with the same `/^\d+$/`-then-`BigInt()` guard Phase 2c's `POST /campaigns` established, verified by asserting the real `bigint` value in the database.

## Risks

- **`penerima` (beneficiary/patient) revisions are not supported**, as documented in "Explicitly Out of Scope" above — a moderator cannot request a revision on patient/beneficiary info in this plan, only the 8 other taxonomy fields. A future phase needs real campaign-scoped patient/beneficiary tables before this gap can close.
- **Self-serve org verification remains entirely unbuilt**, as documented above — this plan's admin surface only ever reviews individual-track campaigns. `campaigners.type: "yayasan"` stays a schema value nothing can currently produce.
- **No admin invite/signup flow.** Promoting a user to `role: "admin"` is a manual database update — deliberate for a first version, not silently missed (see Global Constraints).
- **A rejected/paused campaign never leaves the search index.** This plan's approve action correctly ADDS a newly-active campaign to Meilisearch, but nothing in this plan (or any prior phase) removes a campaign that later becomes `paused`/`rejected`/`completed` — `packages/search/src/campaigns-index.ts`'s own documented limitation (additive-only, no destructive replace) is unchanged by this plan, since nothing here makes an already-active campaign non-active again. A future phase that adds that capability needs the index-swap/alias pattern that file's doc comment already describes.
- **No email/notification when a revision is requested or a campaign is approved.** The campaigner only learns their campaign needs work by visiting `/dashboard` themselves — this plan builds no notification delivery (in-app inbox, email, WhatsApp), matching the master plan's own phase sequencing (notifications land incrementally starting Phase 5, when the first payment receipt needs sending).
- **KYC field validation gaps carried forward from Phase 2c are unchanged by this plan** (NIK isn't digit-checked, no date-of-birth format check) — a moderator reviewing a campaign with malformed-but-technically-present KYC data has no automated flag for it, only their own judgment.
