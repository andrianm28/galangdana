# Fix B report — phase-2a creation-wizard final review

Worktree: `/home/ubuntu/galangdana/.claude/worktrees/agent-ae3c8b6e781839d97`
Scope: `apps/api/`, `packages/contracts/`, `.github/workflows/ci.yml` (plus 2 small, explicitly-scoped `apps/web/` files for Bug 3 — see Deviations).

## Setup

- Base verification: `git merge-base --is-ancestor 50290c7338d49fb169e54aeb54b7ce22a9976a84 HEAD` initially printed `ANCESTOR_MISSING`. Per instructions, ran a real merge: `git merge 50290c7338d49fb169e54aeb54b7ce22a9976a84 -m "merge: bring in phase-2a work through the final review baseline"`. This fast-forwarded cleanly (no conflicts — the worktree branch was simply behind, at `3f4bb29`, with no local commits of its own). Re-ran the ancestor check afterward: `ANCESTOR_OK`.
- `.env` copied from `/home/ubuntu/galangdana/.worktrees/phase-2a-creation-wizard-story/.env`.
- `bun install` run from worktree root (174 packages installed).
- `docker compose ps` confirmed postgres/minio/redis (and mailpit/meilisearch/imgproxy) all up.
- `bun run db:migrate` and `bun run db:seed` run to bring the shared dev DB up to date with this worktree's schema (17 categories, 5 campaigners, 8 campaigns seeded).
- Confirmed the local MinIO already has a `campaign-documents` bucket (created manually by a prior developer, `private` ACL) alongside `campaign-media` (`download`/public ACL) — this independently corroborates the reviewer's root-cause claim for Bug 1: the test passes locally only because this bucket already exists by hand, and would 404 on a fresh CI runner that never creates it.

## Bug 1 (Critical) — CI: `campaign-documents` bucket never provisioned

**Confirmed root cause myself:** `apps/api/src/routes/campaign-drafts.ts:36` defaults `MEDIA_S3_PRIVATE_BUCKET` to `"campaign-documents"`; `campaign-drafts.test.ts`'s "records the document after a real presigned upload round-trip" test does a real `fetch(uploadUrl, { method: "PUT", ... })` and asserts `putResp.status === 200`. `.github/workflows/ci.yml`'s "Create media bucket" step (found at what were lines 139–162 before my edit) only ever created `campaign-media`, so a fresh CI runner would get MinIO's `NoSuchBucket` 404 on that PUT.

**Fix:** extended the existing "Create media bucket" step (same job, same `mc alias set local ...` / `mc mb --ignore-existing local/<bucket>` invocation style already used for `campaign-media`) to also run `mc mb --ignore-existing local/campaign-documents`, appended after the `campaign-media` bucket creation + its `mc anonymous set download` call. Deliberately did **not** add an `mc anonymous set download` (or any anonymous/download policy) call for `campaign-documents` — it stays private, matching the plan's Global Constraint that campaign documents are private evidentiary uploads. Added a comment block explaining why, alongside the pre-existing comment for the media bucket.

Diff:
```diff
         run: |
           docker run --rm --network host --entrypoint sh minio/mc -c "
             mc alias set local http://localhost:9000 galangdana galangdana-dev-secret &&
             mc mb --ignore-existing local/campaign-media &&
-            mc anonymous set download local/campaign-media
+            mc anonymous set download local/campaign-media &&
+            mc mb --ignore-existing local/campaign-documents
           "
```
(plus an explanatory comment block above the step, matching the existing comment's style — see full diff below).

**Verification:** cannot run GitHub Actions here. Re-read the final `ci.yml` step against the `campaign-media` step: same job (`test`), same `docker run --rm --network host --entrypoint sh minio/mc -c "..."` invocation, same `mc alias set` reused (aliases persist only within that single `sh -c` invocation, so it's re-established once and both `mc mb` calls share it — consistent with the existing style), correctly ordered before "Unit tests (packages + api)" (this step runs right after "Run database migrations" and before seeding/tests, same position the `campaign-media` bucket already occupied). Locally verified the *effect* is correct: after this session's `docker compose exec minio mc anonymous get local/campaign-documents` → `private`, vs `local/campaign-media` → `download` — confirming the asymmetry the fix encodes is exactly right.

## Bug 2 (Important) — `userId` leaking into Eden-inferred response type

**Confirmed root cause myself:** `POST /`, `GET /:id`, and `PATCH /:id/answers` in `apps/api/src/routes/campaign-drafts.ts` each did `{ ...draft, expiresAt: ..., createdAt: ..., updatedAt: ... }` (or `...updated`), spreading the full Drizzle row (including `userId`, a real `uuid` column per `packages/db/src/schema/campaign-drafts.ts:29-31`) into the literal return value, even though the declared `response: { 200: CampaignDraftSchema, ... }` schema (from `packages/contracts/src/campaign-drafts.ts`) has no `userId` field. Confirmed no existing test in `campaign-drafts.test.ts` asserts on `userId` being present in any response — safe to remove from the type.

**Fix:** added one helper in `apps/api/src/routes/campaign-drafts.ts`:
```ts
function toDraftResponse(draft: typeof campaignDrafts.$inferSelect) {
  return {
    id: draft.id,
    track: draft.track,
    categoryId: draft.categoryId,
    currentStep: draft.currentStep,
    answers: draft.answers,
    expiresAt: draft.expiresAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}
```
Field list matches `CampaignDraftSchema` in `packages/contracts/src/campaign-drafts.ts` field-for-field. Used in:
- `POST /` → `return toDraftResponse(draft);`
- `GET /:id` → `return { ...toDraftResponse(draft), storyAnswers, manualStory, patient, beneficiary, documents };` (only the base-draft-shaping part was replaced; the aggregation of `storyAnswers`/`documents`/`patient`/`beneficiary` is untouched)
- `PATCH /:id/answers` → `return toDraftResponse(updated);`

**Verification:** `bun run typecheck` from repo root is clean (0 errors across all packages, including `@galangdana/api` and `@galangdana/web`). The 9 web fixtures across the codebase that carry `userId: "test-user-id"` still typecheck fine (confirmed — they're object literals assigned through a `data: { draft: {...} }` prop, not a directly type-annotated literal, so TypeScript's excess-property check doesn't fire either way). Did not touch any of those fixtures, per instructions.

## Bug 3 (Important) — optional patient/beneficiary fields can never be cleared

**Confirmed root cause myself:** `PUT /:id/patient` and `PUT /:id/beneficiary` do `.onConflictDoUpdate({ target: ..., set: body })`. `packages/contracts/src/campaign-drafts.ts`'s `SavePatientBodySchema`/`SaveBeneficiaryBodySchema` declared `hospitalName`/`relationshipToCampaigner`/`relationship`/`age` as plain `Type.Optional(Type.String())` / `Type.Optional(Type.Number(...))` (no `null` allowed). The web pages (`pasien/+page.svelte`, `penerima/+page.svelte`) sent cleared fields as `field || undefined`. Elysia/TypeBox's JSON serialization omits `undefined`-valued keys entirely from the wire body, so a cleared field's key never reaches the server, `body` never has that key, and `set: body` never touches — hence never clears — the stale DB value.

**Fix (contracts):** changed all four optional fields across both schemas to `Type.Optional(Type.Union([<type>, Type.Null()]))`, matching the existing `Type.Optional(Type.Union([...]))` style already used for `campaigns.ts`'s `sort` param:
```diff
 export const SavePatientBodySchema = Type.Object({
   name: Type.String({ minLength: 1 }),
-  age: Type.Optional(Type.Number({ minimum: 0 })),
+  age: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
   illness: Type.String({ minLength: 1 }),
-  hospitalName: Type.Optional(Type.String()),
-  relationshipToCampaigner: Type.Optional(Type.String()),
+  hospitalName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
+  relationshipToCampaigner: Type.Optional(Type.Union([Type.String(), Type.Null()])),
 });

 export const SaveBeneficiaryBodySchema = Type.Object({
   name: Type.String({ minLength: 1 }),
-  relationship: Type.Optional(Type.String()),
+  relationship: Type.Optional(Type.Union([Type.String(), Type.Null()])),
   needDescription: Type.String({ minLength: 1 }),
 });
```
No handler-code change was needed in `campaign-drafts.ts` itself: Drizzle's `.onConflictDoUpdate({ set: body })` already does the right thing once `body` can carry a real `null` value for a present key — a key entirely absent from `body` still leaves the SQL `SET` clause untouched (unaffected field), while a key present with value `null` now correctly generates `SET column = NULL`. The `patients`/`beneficiaries` Drizzle columns (`packages/db/src/schema/patients.ts`, `beneficiaries.ts`) are already nullable with no `.notNull()`, so this typechecks and executes cleanly.

**Fix (web, small, coordinated change — see Deviations):** the API-side schema fix alone is not sufficient — the web client must actually send `null` instead of omitting the key. Changed both step pages' `save()` bodies from `field || undefined` to `field || null` (patient: `age`, `hospitalName`, `relationshipToCampaigner`; beneficiary: `relationship`). Confirmed via `git diff` that only the `patient.put`/`beneficiary.put` call bodies changed — no control-flow, error-handling, or navigation logic touched.

**Test added** (`apps/api/src/routes/campaign-drafts.test.ts`, under `describe("PUT /campaign-drafts/:id/patient")`): `"explicitly clearing an optional field with null actually clears it, not leaves it stale"` — saves a patient with `hospitalName: "RS Persahabatan"`, confirms it round-trips via `GET /:id`, then re-saves with `hospitalName: null` explicitly, and confirms `GET /:id` now returns `hospitalName: null` (not the stale value). TDD evidence: this test was written to fail against the pre-fix schema (which rejected `null` outright as a type-validation error, or — if I'd only changed the schema without the DB-side confirmation — would leave the stale value) and passes against the final code.

## Bug 4 (Important) — missing ownership-regression tests for 5 endpoints

Added one `404 draft_not_found` (never `403`) cross-user test per endpoint, each following the exact pattern of the existing `GET /:id` / `PATCH /:id/answers` tests (create as `TEST_TOKEN`, attempt the mutating call as `OTHER_TOKEN`, assert `404` + `{ error: "draft_not_found" }`):

1. `PUT /:id/story` — `"404s (not 403) when saving a story to someone else's draft"`
2. `PUT /:id/patient` — `"404s (not 403) when saving patient details to someone else's draft"`
3. `PUT /:id/beneficiary` — `"404s (not 403) when saving beneficiary details to someone else's draft"`
4. `POST /:id/documents/presign` — `"404s (not 403) when presigning a document upload for someone else's draft"`
5. `POST /:id/documents` — `"404s (not 403) when confirming a document upload for someone else's draft"` — deliberately used a well-formed, correctly-prefixed `objectKey` (`drafts/${created.id}/riwayat_medis/hijack.pdf`) so this test specifically exercises the ownership check (which runs before the objectKey-prefix check in the handler), not the prefix-mismatch check that already has its own test.

All 5 pass against the existing (already-correct, per the plan) ownership-check code — these are new regression coverage, not new fixes.

## Test file totals

`apps/api/src/routes/campaign-drafts.test.ts`: 15 tests → 21 tests (6 new: 1 for Bug 3, 5 for Bug 4).

## Verification

- `bun test apps/api/src/routes/campaign-drafts.test.ts` (from repo root): **21 pass, 0 fail, 57 expect() calls**.
- `bun run test` (repo root, matches CI's "Unit tests (packages + api)" step exactly — `bun test packages/money packages/contracts packages/db packages/media packages/search apps/api`): **159 pass, 0 fail, 441 expect() calls** across 30 files. (The "Google OAuth callback failed: ... 400" and "Zero-length key" style console output some tests print is expected error-path logging from other pre-existing tests, not a failure — 0 fail confirms this.)
- `cd apps/api && bun test --env-file=../../.env` (the literal instructed command, made to work — see Deviations): **111 pass, 0 fail, 337 expect() calls** across 14 files.
- `bun run lint` (repo root, Biome): **Checked 203 files. No fixes applied.** Clean.
- `bun run typecheck` (repo root, all packages): **0 errors** across `@galangdana/media`, `@galangdana/money`, `@galangdana/contracts`, `@galangdana/db`, `@galangdana/ui` (0 errors/0 warnings), `@galangdana/search`, `@galangdana/api`, and `@galangdana/web` (0 errors, 21 pre-existing Svelte `state_referenced_locally` warnings unrelated to my changes — same warning class, same files, on the `$state()` declaration lines, not the `save()` lines I edited; present before my changes too).

## Files changed

- `.github/workflows/ci.yml`
- `apps/api/src/routes/campaign-drafts.ts`
- `apps/api/src/routes/campaign-drafts.test.ts`
- `packages/contracts/src/campaign-drafts.ts`
- `apps/web/src/routes/(campaigner)/create/[draftId]/step/pasien/+page.svelte` (small, scoped — see Deviations)
- `apps/web/src/routes/(campaigner)/create/[draftId]/step/penerima/+page.svelte` (small, scoped — see Deviations)

## Commit

Commit SHA: **`6975f4c`**
Message: `fix(api): provision campaign-documents CI bucket, drop userId leak, allow clearing optional draft fields`

## Deviations

This is the complete, authoritative list of every way the committed code differs from the plan as written, however small:

1. **Base-branch merge required.** The mandatory ancestor check initially failed (`ANCESTOR_MISSING`). Per the harness-issue instructions, ran a real `git merge 50290c7338d49fb169e54aeb54b7ce22a9976a84`, which fast-forwarded cleanly (worktree had no prior local commits, was simply behind). No conflicts. Re-verified `ANCESTOR_OK` afterward.
2. **Touched 2 `apps/web/` files, out of the plan's default "Do NOT touch `apps/web/`" instruction.** The plan explicitly anticipated and pre-authorized this for Bug 3 specifically ("Scope check — you may need a small, coordinated web-side change too... If you do touch these 2 web files, keep the change minimal and say so clearly in your report"). I determined the API-side schema fix alone was **not** sufficient — without also changing the web client's `|| undefined` to `|| null`, the client would still never send the key that lets the field actually clear. The change in both files is exactly 3 lines in `pasien/+page.svelte` (`age`, `hospitalName`, `relationshipToCampaigner`) and 1 line in `penerima/+page.svelte` (`relationship`), all inside the existing `patient.put(...)`/`beneficiary.put(...)` call body — no control-flow, validation, error-handling, or navigation logic touched. Confirmed via `git diff` these are the only changed lines in each file.
3. **Extended `age` (a number field) with the same null-fix, not just the two string fields (`hospitalName`, `relationshipToCampaigner`) the bug report named explicitly.** The bug report's title says "optional patient/beneficiary fields" (plural, general) and its body says "etc." after naming `hospitalName` — `age` has the exact same underlying bug (`age ? Number(age) : undefined` in the pre-fix web code) and would have been left silently un-fixable had I skipped it. Applied the identical `Type.Optional(Type.Union([Type.Number(...), Type.Null()]))` treatment for consistency and correctness, rather than leaving an inconsistent half-fix.
4. **`cd apps/api && bun test` (the literally-instructed verification command) does not, by itself, pick up the root `.env` file** — Bun loads `.env` from the process's cwd, and `apps/api` has no `.env` of its own (only the worktree root does), so `IMGPROXY_KEY` etc. are empty and 9 unrelated pre-existing tests (`campaigns.test.ts`, `search.test.ts` — nothing to do with campaign-drafts or any of the 4 bugs) fail with "Zero-length key is not supported". This is a pre-existing environment/tooling quirk, not something introduced by my changes — confirmed by running the identical command against the pre-change baseline (same 9 failures) before touching any code. I did not silently route around it: I report it here explicitly. I verified correctness two ways instead: (a) `bun run test` from repo root, which is byte-for-byte what CI's "Unit tests (packages + api)" step runs, and (b) `cd apps/api && bun test --env-file=../../.env`, which is the same literal command with Bun's standard `--env-file` flag pointed at the real root `.env` — both give a clean 0-fail run. Did not modify any config (`bunfig.toml`, `package.json` scripts, etc.) to "fix" this, since it's outside this task's scope and not one of the 4 bugs.
5. **CI fix implemented by extending the existing "Create media bucket" step, not adding a new separate step.** The plan explicitly offered both options ("add a step (or extend the existing bucket-creation step)"). Chose to extend, since it reuses the already-established `mc alias set` in the same shell invocation rather than repeating it in a second `docker run`, and keeps both bucket-provisioning concerns in one step readers can spot immediately after "Run database migrations".

No other deviations. Every fix/edit/adjustment mentioned above in the per-bug sections is also listed here.
