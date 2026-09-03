# Phase 6: Xendit Adapter + Payouts (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the campaign-disbursement ("pencairan") subsystem: campaigners request a payout of collected donation funds to a verified bank account through a guided, OTP-confirmed wizard; admins review, approve, and execute the payout; donors see a public disbursement log per campaign. Verify the program-campaign withdrawable-balance formula against real data flowing through an actual disbursement.

**Architecture:** Follows this repo's established atomic-transition-guard convention (`UPDATE ... WHERE <status guard> RETURNING`, `.length === 0` check) for every state change, the `findOwnedCampaign`-style ownership pattern for campaigner-facing routes, and `checkAdmin` for admin routes. The campaigner wizard is a multi-page SvelteKit flow that progressively `PATCH`es one `disbursement_requests` row by id, mirroring the campaign-drafts wizard's `[draftId]/step/*` URL convention. Payout execution goes through the existing `PaymentProvider` interface's `createPayout` method (currently stubbed in `MockPaymentProvider`), so a real Xendit adapter can be dropped in later without touching any route code.

**Tech Stack:** SvelteKit 2 (adapter-node, SSR), ElysiaJS on Bun, TypeBox contracts + Eden Treaty, Drizzle + Postgres, Bun.S3Client (MinIO), Vitest + happy-dom for component tests, `bun test` for backend.

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` (master plan) — Domain Model's `bank_accounts`/`disbursement_requests` entries, Payment Architecture's "Payouts" paragraph, Phase 6's module-map row (`Disbursement | /dashboard/campaigns/[id]/pencairan/{type,rekening,upload,capture-preview,detail,otp,summary,in-process}`), and the Risks section's "verify the program-campaign balance formula against real data" item.

## Scope Note (read before dispatching any task)

This plan implements **Slice 1** of Phase 6, narrowed the same way Phase 5 was narrowed — by ruling on two real blockers/risks rather than asking a human mid-plan:

1. **No real Xendit sandbox credentials exist.** Exactly the blocker that deferred a real Midtrans adapter in Phase 5. `PaymentProvider.createPayout` stays served by `MockPaymentProvider`, but Task 4 requires the implementer to research Xendit's real, publicly documented Disbursement API (endpoint shape, request/response fields, the `x-callback-token` verification scheme) and mirror that wire format in the mock — exactly how Phase 5's mock provider mirrored Midtrans's real signature scheme — so a real adapter reuses the shape unchanged later. **Do not guess the format from training memory alone** — verify it with a live web search during implementation, the same way Phase 5 Task 3's reviewer independently verified the Midtrans signature formula.
2. **The master plan's own 8-URL pencairan wizard (`type,rekening,upload,capture-preview,detail,otp,summary,in-process`) is trimmed to 6 real pages for this slice**, the same kind of narrowing Phase 5 applied to payment methods (18 → 1). The trim: `type` (partial vs. final) merges onto the `detail` page as one more field alongside amount/narrative — it doesn't carry enough independent weight for its own URL. `capture-preview` merges into `upload` — the preview is a state of the same upload step, not a separate page in a guided flow this size. The result — `rekening → upload → detail → otp → summary → in-process` — is still a complete, real, multi-page guided flow; nothing is stubbed or faked.

**Explicitly out of scope for this slice** (do not build, do not stub with a TODO — simply not present):
- A real `XenditProvider` class making live API calls.
- `apps/worker` / any payout queue or reconciler. Every state transition in this plan happens synchronously inside the HTTP request that causes it. There is no `processing` gap to represent, so the `disbursement_status` enum's `processing` value exists (matching the master plan's domain model literally) but this plan's own code never sets it — a future async payout queue is what will use it.
- Automated bank-account-ownership verification (e.g. a real-time account-name-lookup API). `bank_accounts.verifiedAt` is set by an admin action, mirroring how `individual_verifications` is already reviewed manually in this codebase.
- Grant-milestone payouts (CSR module, Phase 9) — this plan touches only campaign disbursement.
- Any change to the *public* "Donasi tersedia" figure's formula (`displayAmount()` in `packages/db/src/schema/campaigns.ts`, `collectedAmount - disbursedAmount`) — that stays as-is. This plan adds a *second*, more complete formula (below) used only server-side to gate new disbursement requests.

## Global Constraints

- Money is `bigint`, currency-tagged via `packages/money`'s `Money`/`MoneyJSON`/`moneyToJSON`/`moneyFromJSON` — never `number`, never float, everywhere a disbursement amount is read, written, or displayed.
- Every status transition on `disbursement_requests` uses the atomic-transition-guard pattern already established in `apps/api/src/routes/admin.ts` and `apps/api/src/routes/donations.ts`: `db.transaction`, `UPDATE ... WHERE id = ? AND status = '<expected>' RETURNING`, check `.length === 0` and treat it as a 409 (or, where established elsewhere in this plan, a no-op), never a bare unguarded `UPDATE`.
- Campaigner-facing routes (bank accounts, disbursement requests) use the **404-not-403** ownership pattern already established by `findOwnedCampaign` in `apps/api/src/routes/campaigns.ts` — a disbursement request that exists but belongs to someone else's campaign returns the identical 404 as one that doesn't exist at all.
- Admin routes use `checkAdmin(user)` from `apps/api/src/lib/admin.ts` — 401 unauthenticated, 403 authenticated-but-not-admin (role-scoped, not ownership-scoped — this is intentional and already the convention in `admin.ts`).
- The `disbursement_status` enum is exactly `["draft", "otp_pending", "requested", "approved", "rejected", "paid", "failed", "processing"]`, matching the master plan's domain model. This plan's code only ever transitions through `draft → otp_pending → requested → approved → paid` (happy path) or `requested → rejected` / `approved → failed` (unhappy paths) — `processing` is a reserved value for a future async worker, never set by this plan.
- **Withdrawable balance formula** (verify-against-real-data deliverable): `withdrawable = collectedAmount - totalPlatformFees - disbursedAmount - pendingDisbursementsAmount`, where `totalPlatformFees = SUM(donations.platformFee) WHERE campaignId = ? AND status = 'paid'` and `pendingDisbursementsAmount = SUM(disbursement_requests.amount) WHERE campaignId = ? AND status IN ('otp_pending', 'requested', 'approved')`. This is distinct from the existing public-display `displayAmount()` helper (`collectedAmount - disbursedAmount`, unchanged) — the withdrawable formula additionally accounts for the platform fee already taken out of each donation and for money already earmarked by an in-flight (not yet paid, not yet rejected) disbursement request, so two simultaneous requests can't jointly overdraw the same balance.
- A new disbursement request's `amount` must never exceed the withdrawable balance computed at creation/detail-save time — reject with a 422 if it does.
- OTP: `apps/api/src/auth/otp.ts`'s `requestOtp`/`verifyOtp` are generalized to take a `purpose: "login" | "disbursement"` parameter, threaded into a new `otp_challenges.purpose` column. A login OTP must never verify a disbursement confirmation and vice versa — every query in `otp.ts` that reads or writes `otp_challenges` must filter by `purpose` as well as `phone`.
- The public disbursement log (`GET /campaigns/:slug/disbursements`, the `pencairan-dana` page) returns only `paid` disbursements, and only `amount`, `narrative`, `type`, and `paidAt` — never `bankAccountId`, account number, or account holder name.
- Every new backend route file gets full `bun test` coverage hitting the real Elysia app against real Postgres (this codebase's established convention — no mocked DB layer anywhere in `apps/api`'s tests). Every new frontend page gets a `page.render.test.ts` using `@testing-library/svelte` against `happy-dom`, matching every existing `*.render.test.ts` in this repo.
- Reuse `privateDocumentsS3` (`apps/api/src/lib/media-s3.ts`) and `extractDocumentExtension`/`ALLOWED_DOCUMENT_EXTENSIONS` for the disbursement proof-document upload — do not create a second S3 client or a second extension allowlist.
- Eden Treaty route-tree note (already a Global Constraint in this codebase, restated because this plan's route files hit it): a kebab-case route segment (e.g. `/bank-accounts`) is **not** camelCased by Eden — call it via bracket notation (`api["bank-accounts"]`), and a route tree that mixes a collection-level verb with dynamic `:id` sub-routes produces an intersection type Eden can't narrow on its own — cast the callable `as any`, then re-cast the awaited result to the real `Treaty.TreatyResponse<{...}>` shape from `@galangdana/contracts`, exactly as done throughout Phase 3/4/5's frontend tasks.

## File Structure

```
packages/db/src/schema/
  bank-accounts.ts           new — campaigner payout destinations
  disbursement-requests.ts   new — the pencairan state machine
  otp-challenges.ts          modify — add `purpose` column
  index.ts                   modify — export the two new schema files

packages/db/drizzle/         new migration (generated, not hand-written)

packages/contracts/src/
  disbursements.ts           new — all request/response schemas for this plan
  index.ts                   modify — re-export disbursements.ts

packages/payments/src/
  types.ts                   modify — extend PayoutInput/PayoutResult to match the real Xendit shape
  mock-provider.ts           modify — implement createPayout for real
  mock-provider.test.ts      modify — add payout tests

apps/api/src/auth/
  otp.ts                     modify — add `purpose` param to requestOtp/verifyOtp

apps/api/src/routes/
  bank-accounts.ts           new — POST/GET /campaigns/:id/bank-accounts
  disbursements.ts           new — the whole campaigner + admin + public disbursement API
  index.ts (or wherever routes are mounted — see Task 5)

apps/web/src/routes/(campaigner)/dashboard/campaigns/
  +page.svelte                                    modify — add "Ajukan Pencairan" entry link
  [id]/pencairan/+page.server.ts                  new — creates the draft row, redirects
  [id]/pencairan/[disbursementId]/rekening/+page.server.ts + +page.svelte    new
  [id]/pencairan/[disbursementId]/upload/+page.server.ts + +page.svelte     new
  [id]/pencairan/[disbursementId]/detail/+page.server.ts + +page.svelte     new
  [id]/pencairan/[disbursementId]/otp/+page.server.ts + +page.svelte        new
  [id]/pencairan/[disbursementId]/summary/+page.server.ts + +page.svelte    new
  [id]/pencairan/[disbursementId]/in-process/+page.server.ts + +page.svelte new

apps/web/src/routes/(admin)/disbursements/
  +page.server.ts + +page.svelte    new — admin queue + approve/reject/pay actions

apps/web/src/routes/(consumer)/campaign/[slug]/pencairan-dana/
  +page.server.ts + +page.svelte    new — public disbursement log
```

---

## Task 1: Schema — bank_accounts, disbursement_requests, otp_challenges.purpose

**Files:**
- Create: `packages/db/src/schema/bank-accounts.ts`
- Create: `packages/db/src/schema/disbursement-requests.ts`
- Modify: `packages/db/src/schema/otp-challenges.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `packages/db/src/__tests__/bank-accounts.test.ts`
- Test: `packages/db/src/__tests__/disbursement-requests.test.ts`

**Interfaces:**
- Produces: `bankAccounts` table, `BankAccount`/`NewBankAccount` types; `disbursementRequests` table, `disbursementTypeEnum`, `disbursementStatusEnum`, `DisbursementRequest`/`NewDisbursementRequest` types; `otpChallenges.purpose` column, `otpPurposeEnum`.
- Consumes: `campaigners` (Task-1-independent, already exists), `campaigns`, `users`.

- [ ] **Step 1: Write `bank-accounts.ts`**

```typescript
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigners } from "./campaigners";

/**
 * A campaigner's payout destination. verifiedAt is set by an admin
 * action (see disbursements.ts Task 8) -- there is no automated
 * real-time account-name-lookup in this slice, mirroring how
 * individual_verifications is already reviewed manually in this
 * codebase, not via a third-party API.
 */
export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignerId: uuid("campaigner_id")
    .notNull()
    .references(() => campaigners.id, { onDelete: "cascade" }),
  bankCode: text("bank_code").notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  accountHolderName: text("account_holder_name").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
```

- [ ] **Step 2: Write `disbursement-requests.ts`**

```typescript
import { bigint, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bankAccounts } from "./bank-accounts";
import { campaignCurrencyEnum, campaigns } from "./campaigns";
import { users } from "./users";

export const disbursementTypeEnum = pgEnum("disbursement_type", ["partial", "final"]);

// "processing" is reserved for a future async payout worker/queue --
// this plan's own route code (Task 8) never sets it, transitioning
// approved -> paid directly. Included now so the column doesn't need a
// migration when that worker lands later.
export const disbursementStatusEnum = pgEnum("disbursement_status", [
  "draft",
  "otp_pending",
  "requested",
  "approved",
  "rejected",
  "processing",
  "paid",
  "failed",
]);

export const disbursementRequests = pgTable("disbursement_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id),
  type: disbursementTypeEnum("type"),
  amount: bigint("amount", { mode: "bigint" }),
  currency: campaignCurrencyEnum("currency"),
  narrative: text("narrative"),
  proofObjectKey: text("proof_object_key"),
  status: disbursementStatusEnum("status").notNull().default("draft"),
  otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  payoutRef: text("payout_ref"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DisbursementRequest = typeof disbursementRequests.$inferSelect;
export type NewDisbursementRequest = typeof disbursementRequests.$inferInsert;
```

`bankAccountId`, `type`, `amount`, `currency`, and `narrative` are nullable because the wizard fills them in progressively across pages (Tasks 10-14) — the row is created in `draft` status before any of them are known, mirroring `campaign_drafts`' own progressive-fill pattern. The `POST /campaigns/:id/disbursements/:disbursementId/otp/request` handler (Task 7) validates all of them are populated before allowing the transition out of `draft`.

- [ ] **Step 3: Add `purpose` to `otp-challenges.ts`**

Modify `packages/db/src/schema/otp-challenges.ts`:

```typescript
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Existing rows (all pre-Phase-6 login OTPs) get "login" via the
// migration's server_default -- see Step 5. A disbursement OTP
// challenge must never verify a login attempt and vice versa; every
// query in otp.ts (Task 3) filters on purpose, not just phone.
export const otpPurposeEnum = pgEnum("otp_purpose", ["login", "disbursement"]);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    purpose: otpPurposeEnum("purpose").notNull().default("login"),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The existing (phone, createdAt) index no longer fully matches
    // verifyOtp's WHERE clause once purpose is added (Task 3) -- extend
    // it to (phone, purpose, createdAt) rather than adding a second index.
    index("otp_challenges_phone_purpose_created_at_idx").on(
      table.phone,
      table.purpose,
      table.createdAt,
    ),
  ],
);

export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type NewOtpChallenge = typeof otpChallenges.$inferInsert;
```

Note the old single-column index (`otp_challenges_phone_created_at_idx`) is replaced, not kept alongside the new one — `drizzle-kit generate` will detect the rename and emit a drop-old/create-new migration; let it.

- [ ] **Step 4: Update `packages/db/src/schema/index.ts`**

Add two lines, keeping the existing alphabetical-ish grouping style already in the file:

```typescript
export * from "./bank-accounts";
export * from "./disbursement-requests";
```

- [ ] **Step 5: Generate and review the migration**

```bash
cd packages/db && bun run drizzle-kit generate
```

Read the generated SQL file. Confirm it:
- Creates `bank_accounts` and `disbursement_requests` tables with the exact columns above.
- Adds the `otp_purpose` enum and the `otp_challenges.purpose` column with `DEFAULT 'login'` (so existing rows backfill correctly) and `NOT NULL`.
- Drops the old `otp_challenges_phone_created_at_idx` and creates the new three-column index.

Apply it against the dev DB (`bun run db:migrate` from the repo root, or whatever this repo's existing migrate command is — check `package.json`) and confirm it applies cleanly.

- [ ] **Step 6: Write `packages/db/src/__tests__/bank-accounts.test.ts`**

```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../client";
import { bankAccounts, campaigners, users } from "../schema";

describe("bank_accounts", () => {
  let campaignerId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62811${Date.now()}` })
      .returning();
    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test Campaigner", userId: user?.id })
      .returning();
    // biome-ignore lint/style/noNonNullAssertion: inserted above
    campaignerId = campaigner!.id;
  });

  afterAll(async () => {
    await db.delete(bankAccounts).where(eq(bankAccounts.campaignerId, campaignerId));
  });

  test("a bank account can be created and defaults verifiedAt to null", async () => {
    const [row] = await db
      .insert(bankAccounts)
      .values({
        campaignerId,
        bankCode: "bca",
        bankName: "Bank Central Asia",
        accountNumber: "1234567890",
        accountHolderName: "Test Campaigner",
      })
      .returning();
    expect(row?.verifiedAt).toBeNull();
    expect(row?.accountNumber).toBe("1234567890");
  });
});
```

Add the missing `eq` import from `drizzle-orm` at the top. Adjust the exact `db`/`schema` import paths to match this package's existing test files (check an existing file under `packages/db/src/__tests__/` for the real import paths — e.g. `payments.test.ts` from Phase 5 — before finalizing; this snippet approximates the convention but the real paths must match exactly).

- [ ] **Step 7: Write `packages/db/src/__tests__/disbursement-requests.test.ts`**

```typescript
import { describe, expect, test } from "bun:test";
import { db } from "../client";
import { campaignCategories, campaigners, campaigns, disbursementRequests, users } from "../schema";

describe("disbursement_requests", () => {
  test("a row can be created in draft status with nullable fields unset", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: `+62812${Date.now()}` })
      .returning();
    const [campaigner] = await db
      .insert(campaigners)
      .values({ type: "individual", displayName: "Test", userId: user?.id })
      .returning();
    const [category] = await db.select().from(campaignCategories).limit(1);
    const [campaign] = await db
      .insert(campaigns)
      .values({
        slug: `test-campaign-${Date.now()}`,
        title: "Test",
        shortDescription: "Test",
        story: "Test",
        model: "goal",
        goalAmount: 1_000_000n,
        status: "active",
        categoryId: category?.id,
        campaignerId: campaigner?.id,
      })
      .returning();

    const [row] = await db
      .insert(disbursementRequests)
      .values({ campaignId: campaign?.id ?? "" })
      .returning();

    expect(row?.status).toBe("draft");
    expect(row?.amount).toBeNull();
    expect(row?.bankAccountId).toBeNull();
  });
});
```

Adjust the `campaigns` insert to match that table's exact required-column shape (re-check `packages/db/src/schema/campaigns.ts` — some fields shown here, like `expiresAt`, may need explicit `null` for a `goal`-model row per its existing CHECK constraint; confirm against the constraint text already in that file before finalizing).

- [ ] **Step 8: Run tests, lint, typecheck**

```bash
cd packages/db && bun test src/__tests__/bank-accounts.test.ts src/__tests__/disbursement-requests.test.ts --env-file=../../.env
bun run lint
bun run typecheck
```

Fix any failures. Confirm the full `bun run test` (repo root) baseline is still 280 pass / 3 known-pre-existing fail (the documented `campaigns.test.ts` isolation gap) — no new failures.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema/bank-accounts.ts packages/db/src/schema/disbursement-requests.ts \
  packages/db/src/schema/otp-challenges.ts packages/db/src/schema/index.ts \
  packages/db/drizzle/ packages/db/src/__tests__/bank-accounts.test.ts \
  packages/db/src/__tests__/disbursement-requests.test.ts
git commit -m "feat(db): add bank_accounts, disbursement_requests, and otp purpose scoping"
```

---

## Task 2: Contracts

**Files:**
- Create: `packages/contracts/src/disbursements.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `MoneyJSONSchema` (from `./campaigns.ts`, already exported), `disbursementTypeEnum`/`disbursementStatusEnum` values from Task 1 (as literal string unions, not a runtime import — `packages/contracts` doesn't depend on `packages/db`, matching this repo's existing convention of hand-listing enum literals, e.g. `DonationStatusSchema` in `payments.ts`).
- Produces: every schema below, re-exported from `index.ts`.

- [ ] **Step 1: Write `disbursements.ts`**

```typescript
import { t } from "elysia";
import { MoneyJSONSchema } from "./campaigns";

export const DisbursementErrorSchema = t.Object({ error: t.String() });

export const BankAccountSchema = t.Object({
  id: t.String(),
  bankCode: t.String(),
  bankName: t.String(),
  accountNumber: t.String(),
  accountHolderName: t.String(),
  verifiedAt: t.Union([t.String(), t.Null()]),
});

export const CreateBankAccountBodySchema = t.Object({
  bankCode: t.String(),
  bankName: t.String(),
  accountNumber: t.String(),
  accountHolderName: t.String(),
});

export const BankAccountListResponseSchema = t.Object({
  bankAccounts: t.Array(BankAccountSchema),
});

export const DisbursementStatusSchema = t.Union([
  t.Literal("draft"),
  t.Literal("otp_pending"),
  t.Literal("requested"),
  t.Literal("approved"),
  t.Literal("rejected"),
  t.Literal("processing"),
  t.Literal("paid"),
  t.Literal("failed"),
]);

export const DisbursementTypeSchema = t.Union([t.Literal("partial"), t.Literal("final")]);

export const DisbursementDetailSchema = t.Object({
  id: t.String(),
  campaignId: t.String(),
  bankAccountId: t.Union([t.String(), t.Null()]),
  type: t.Union([DisbursementTypeSchema, t.Null()]),
  amount: t.Union([MoneyJSONSchema, t.Null()]),
  narrative: t.Union([t.String(), t.Null()]),
  proofObjectKey: t.Union([t.String(), t.Null()]),
  status: DisbursementStatusSchema,
  otpVerifiedAt: t.Union([t.String(), t.Null()]),
  rejectedReason: t.Union([t.String(), t.Null()]),
  payoutRef: t.Union([t.String(), t.Null()]),
  paidAt: t.Union([t.String(), t.Null()]),
  withdrawableAmount: MoneyJSONSchema,
});

export const CreateDisbursementResponseSchema = t.Object({ id: t.String() });

export const SaveDisbursementBankAccountBodySchema = t.Object({ bankAccountId: t.String() });

export const SaveDisbursementDetailBodySchema = t.Object({
  type: DisbursementTypeSchema,
  amountStr: t.String(),
  narrative: t.String(),
});

export const PresignDisbursementProofBodySchema = t.Object({ fileName: t.String() });

export const PresignDisbursementProofResponseSchema = t.Object({
  uploadUrl: t.String(),
  objectKey: t.String(),
  expiresInSeconds: t.Number(),
});

export const ConfirmDisbursementProofBodySchema = t.Object({ objectKey: t.String() });

export const RequestDisbursementOtpResponseSchema = t.Object({ sent: t.Boolean() });

export const VerifyDisbursementOtpBodySchema = t.Object({ code: t.String() });

export const VerifyDisbursementOtpResponseSchema = t.Object({ verified: t.Boolean() });

export const DisbursementActionResponseSchema = t.Object({ status: DisbursementStatusSchema });

export const AdminDisbursementListItemSchema = t.Object({
  id: t.String(),
  campaignId: t.String(),
  campaignTitle: t.String(),
  type: DisbursementTypeSchema,
  amount: MoneyJSONSchema,
  status: DisbursementStatusSchema,
  createdAt: t.String(),
});

export const AdminDisbursementListResponseSchema = t.Object({
  disbursements: t.Array(AdminDisbursementListItemSchema),
});

export const AdminDisbursementDetailSchema = t.Object({
  id: t.String(),
  campaignId: t.String(),
  campaignTitle: t.String(),
  bankAccount: t.Object({
    bankName: t.String(),
    accountNumber: t.String(),
    accountHolderName: t.String(),
    verifiedAt: t.Union([t.String(), t.Null()]),
  }),
  type: DisbursementTypeSchema,
  amount: MoneyJSONSchema,
  narrative: t.String(),
  proofViewUrl: t.Union([t.String(), t.Null()]),
  status: DisbursementStatusSchema,
  createdAt: t.String(),
});

export const AdminRejectDisbursementBodySchema = t.Object({ reason: t.String() });

export const PublicDisbursementLogItemSchema = t.Object({
  type: DisbursementTypeSchema,
  amount: MoneyJSONSchema,
  narrative: t.String(),
  paidAt: t.String(),
});

export const PublicDisbursementLogResponseSchema = t.Object({
  disbursements: t.Array(PublicDisbursementLogItemSchema),
});
```

`DisbursementDetailSchema.withdrawableAmount` is populated fresh on every read (not stored) — see Task 6's `GET` handler.

- [ ] **Step 2: Update `packages/contracts/src/index.ts`**

Add, following the file's existing per-module export-block convention:

```typescript
export {
  AdminDisbursementDetailSchema,
  AdminDisbursementListItemSchema,
  AdminDisbursementListResponseSchema,
  AdminRejectDisbursementBodySchema,
  BankAccountListResponseSchema,
  BankAccountSchema,
  ConfirmDisbursementProofBodySchema,
  CreateBankAccountBodySchema,
  CreateDisbursementResponseSchema,
  DisbursementActionResponseSchema,
  DisbursementDetailSchema,
  DisbursementErrorSchema,
  DisbursementStatusSchema,
  DisbursementTypeSchema,
  PresignDisbursementProofBodySchema,
  PresignDisbursementProofResponseSchema,
  PublicDisbursementLogItemSchema,
  PublicDisbursementLogResponseSchema,
  RequestDisbursementOtpResponseSchema,
  SaveDisbursementBankAccountBodySchema,
  SaveDisbursementDetailBodySchema,
  VerifyDisbursementOtpBodySchema,
  VerifyDisbursementOtpResponseSchema,
} from "./disbursements";
export type {
  AdminDisbursementDetailResponse,
  AdminDisbursementListResponse,
  BankAccountListResponse,
  DisbursementDetailResponse,
  PublicDisbursementLogResponse,
} from "./disbursements";
```

Add the four `export type` names as `Static<typeof ...>` type aliases at the bottom of `disbursements.ts` itself, matching how `campaigns.ts` defines e.g. `export type CampaignDetailResponse = Static<typeof CampaignDetailSchema>;` at its own bottom (check that file for the exact pattern before adding).

- [ ] **Step 3: Run lint/typecheck**

```bash
bun run lint && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/disbursements.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add disbursement/bank-account schemas"
```

---

## Task 3: Generalize OTP with a `purpose` parameter

**Files:**
- Modify: `apps/api/src/auth/otp.ts`
- Modify: every existing caller of `requestOtp`/`verifyOtp` (search for them — likely `apps/api/src/routes/auth.ts` and the KYC OTP step's route)
- Test: existing `otp.test.ts` (extend, don't replace)

**Interfaces:**
- Produces: `requestOtp(phone, purpose, smsProvider?)`, `verifyOtp(phone, code, purpose)` — both now take a required `purpose: "login" | "disbursement"` parameter.
- Consumes: `otpPurposeEnum` from Task 1.

- [ ] **Step 1: Find every existing caller**

```bash
grep -rn "requestOtp(\|verifyOtp(" apps/api/src --include="*.ts" | grep -v test
```

Every call site found needs `"login"` passed as the new parameter — this task is a pure signature generalization for existing behavior, not a behavior change for login/KYC OTP flows.

- [ ] **Step 2: Modify `otp.ts`**

Add `purpose: (typeof otpPurposeEnum.enumValues)[number]` as a parameter to both functions, threaded into every DB query that touches `otpChallenges`:

```typescript
import { db, otpChallenges, type otpPurposeEnum, users } from "@galangdana/db";
// ... existing imports unchanged

export async function requestOtp(
  phone: string,
  purpose: (typeof otpPurposeEnum.enumValues)[number],
  smsProvider: SmsProvider = new ConsoleSmsProvider(),
): Promise<RequestOtpResult> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { sent: false, reason: "invalid_phone" };
  }

  const rateLimit = await checkOtpRateLimit(normalized);
  if (!rateLimit.allowed) {
    return {
      sent: false,
      reason: "rate_limited",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  const code = generateOtpCode();
  const codeHash = await Bun.password.hash(code, { algorithm: "argon2id" });

  await db.insert(otpChallenges).values({
    phone: normalized,
    purpose,
    codeHash,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await smsProvider.sendOtp(normalized, code);
  return { sent: true };
}

export async function verifyOtp(
  phone: string,
  code: string,
  purpose: (typeof otpPurposeEnum.enumValues)[number],
): Promise<VerifyOtpResult> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { success: false, reason: "invalid_phone" };
  }

  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(
      and(
        eq(otpChallenges.phone, normalized),
        eq(otpChallenges.purpose, purpose),
        isNull(otpChallenges.consumedAt),
      ),
    )
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  if (!challenge) {
    return { success: false, reason: "not_found" };
  }

  if (challenge.expiresAt.getTime() <= Date.now()) {
    return { success: false, reason: "expired" };
  }

  const [claimed] = await db
    .update(otpChallenges)
    .set({ attempts: sql`${otpChallenges.attempts} + 1` })
    .where(
      and(
        eq(otpChallenges.id, challenge.id),
        isNull(otpChallenges.consumedAt),
        lt(otpChallenges.attempts, MAX_VERIFY_ATTEMPTS),
      ),
    )
    .returning();

  if (!claimed) {
    return { success: false, reason: "too_many_attempts" };
  }

  const isValid = await Bun.password.verify(code, claimed.codeHash);
  if (!isValid) {
    return { success: false, reason: "incorrect_code" };
  }

  const [consumed] = await db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpChallenges.id, claimed.id), isNull(otpChallenges.consumedAt)))
    .returning();

  if (!consumed) {
    return { success: false, reason: "already_used" };
  }

  // Only the "login" purpose creates/returns a User -- a disbursement OTP
  // verifies an ALREADY-authenticated campaigner's intent to submit a
  // specific payout request, it doesn't authenticate a phone number into
  // a session. Task 7's caller ignores `user` for purpose "disbursement".
  if (purpose !== "login") {
    return { success: true };
  }

  const [created] = await db
    .insert(users)
    .values({ phone: normalized })
    .onConflictDoUpdate({ target: users.phone, set: { updatedAt: new Date() } })
    .returning();
  return { success: true, user: created };
}
```

This is a real behavioral decision worth calling out: the disbursement OTP path never touches the `users` table, since the campaigner is already authenticated via their session cookie by the time they reach the OTP wizard step (Task 13's `+page.server.ts` redirects to `/login` otherwise, matching every other campaigner-dashboard page in this codebase) — the OTP here is a re-confirmation of intent (matching Kitabisa's real disbursement OTP UX, "confirm it's really you before we move money"), not an identity-creation step.

- [ ] **Step 3: Update every existing call site found in Step 1** to pass `"login"` as the second argument (for `requestOtp`) or third argument (for `verifyOtp`).

- [ ] **Step 4: Extend the existing OTP test file** with purpose-isolation tests — find the existing test file (likely `apps/api/src/auth/otp.test.ts`) and add:

```typescript
test("a login OTP challenge cannot be verified against the disbursement purpose", async () => {
  const phone = `+62813${Date.now()}`;
  await requestOtp(phone, "login", new FakeSmsProvider());
  // FakeSmsProvider (check the existing test file for its real name/shape)
  // captures the sent code -- reuse that mechanism here.
  const code = /* extracted from the fake provider, matching existing test style */ "";
  const result = await verifyOtp(phone, code, "disbursement");
  expect(result.success).toBe(false);
  expect(result.reason).toBe("not_found");
});
```

Adjust to match the real existing fake-SMS-capture mechanism in the current test file exactly (read it first) rather than inventing a new one.

- [ ] **Step 5: Run tests, lint, typecheck**

```bash
cd apps/api && bun test src/auth/otp.test.ts --env-file=../../.env
cd /path/to/repo/root && bun run test --env-file=.env
bun run lint && bun run typecheck
```

Confirm no existing login/KYC OTP test broke (the signature change is additive-required, so every pre-existing call site must have been updated in Step 3, not left broken).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/otp.ts apps/api/src/auth/otp.test.ts <every call-site file touched in Step 3>
git commit -m "feat(auth): generalize OTP challenges with a purpose scope (login | disbursement)"
```

---

## Task 4: MockPaymentProvider.createPayout — real Xendit disbursement wire format

**Files:**
- Modify: `packages/payments/src/types.ts`
- Modify: `packages/payments/src/mock-provider.ts`
- Modify: `packages/payments/src/mock-provider.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PayoutInput`/`PayoutResult` (extended), `MockPaymentProvider.createPayout(input): Promise<PayoutResult>` (implemented, no longer throwing).

**Research requirement (do this before writing code):** Xendit's real Disbursement API is publicly documented. Web-search for Xendit's current Disbursement API (create disbursement) request/response field names and their disbursement callback/webhook verification scheme (Xendit uses a shared-secret `x-callback-token` header comparison, not a Midtrans-style computed signature — verify this, don't assume it, the same way Phase 5 Task 3 verified Midtrans's SHA-512 formula against real docs rather than guessing). Confirm: the exact request field names for amount, destination bank code, account holder name, account number, and an idempotency/external-reference field; the exact response field names including a status field and its possible values; and the callback-token header name and comparison scheme. Use what you find to shape the types and mock below — if any exact field name in this brief turns out to not match the real docs, use the real one and note the correction in your report, exactly as Phase 5 Task 5's implementer corrected the brief's own webhook-guard code after finding a real bug.

- [ ] **Step 1: Extend `types.ts`**

```typescript
export interface PayoutInput {
  externalId: string;
  amount: bigint;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  description: string;
}

export interface PayoutResult {
  payoutId: string;
  status: "pending" | "completed" | "failed";
}
```

(Field names here are a starting sketch — replace with whatever your research in the preamble above confirms as Xendit's real request/response field names, keeping the same TypeScript shape/purpose. Do not skip the research step and ship this sketch unverified.)

- [ ] **Step 2: Implement `createPayout` in `mock-provider.ts`**

```typescript
async createPayout(input: PayoutInput): Promise<PayoutResult> {
  // Mirrors Xendit's real Disbursement API response shape (verified via
  // web search, see Task 4's brief) so a real XenditProvider later
  // reuses this exact interface unchanged -- matching how
  // MockPaymentProvider's createCharge/parseWebhook already mirror
  // Midtrans's real wire format. This mock completes synchronously
  // ("completed" immediately) since there's no async payout queue in
  // this slice (see this plan's Scope Note) -- a real adapter's
  // createPayout would likely return "pending" and complete later via
  // a callback, which this plan's Task 8 does not yet consume.
  return {
    payoutId: `payout-${input.externalId}`,
    status: "completed",
  };
}
```

- [ ] **Step 3: Update `mock-provider.test.ts`**

Replace the existing `"createPayout is not implemented (payouts are Phase 6)"` test (it now asserts the opposite) with:

```typescript
test("createPayout returns a completed payout synchronously", async () => {
  const provider = new MockPaymentProvider({ serverKey: "test-key" });
  const result = await provider.createPayout({
    externalId: "disb-123",
    amount: 500_000n,
    bankCode: "bca",
    accountNumber: "1234567890",
    accountHolderName: "Test Campaigner",
    description: "Pencairan dana kampanye",
  });
  expect(result.status).toBe("completed");
  expect(result.payoutId).toContain("disb-123");
});
```

(Adjust field names to match whatever Step 1's research produced.)

- [ ] **Step 4: Run tests, lint, typecheck**

```bash
cd packages/payments && bun test
cd /path/to/repo/root && bun run lint && bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/payments/src/types.ts packages/payments/src/mock-provider.ts packages/payments/src/mock-provider.test.ts
git commit -m "feat(payments): implement MockPaymentProvider.createPayout against Xendit's real disbursement wire format"
```

---

## Task 5: Bank accounts endpoints

**Files:**
- Create: `apps/api/src/routes/bank-accounts.ts`
- Modify: wherever routes are mounted (find via `grep -rn "campaignsRoute\|donationsRoute" apps/api/src/index.ts`)
- Test: `apps/api/src/routes/bank-accounts.test.ts`

**Interfaces:**
- Consumes: `findOwnedCampaign`-style ownership pattern (this task needs a campaigner-lookup, not a campaign-lookup — see Step 1), `sessionDerive`.
- Produces: `bankAccountsRoute`, mounted alongside the other route plugins.

- [ ] **Step 1: Write `bank-accounts.ts`**

```typescript
import {
  BankAccountListResponseSchema,
  CreateBankAccountBodySchema,
  DisbursementErrorSchema,
} from "@galangdana/contracts";
import { bankAccounts, campaigners, db } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

async function findOwnCampaigner(userId: string) {
  const [campaigner] = await db
    .select()
    .from(campaigners)
    .where(eq(campaigners.userId, userId));
  return campaigner ?? null;
}

export const bankAccountsRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/bank-accounts",
    async ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaigner = await findOwnCampaigner(user.id);
      if (!campaigner) {
        return { bankAccounts: [] };
      }
      const rows = await db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.campaignerId, campaigner.id));
      return {
        bankAccounts: rows.map((row) => ({
          id: row.id,
          bankCode: row.bankCode,
          bankName: row.bankName,
          accountNumber: row.accountNumber,
          accountHolderName: row.accountHolderName,
          verifiedAt: row.verifiedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      response: { 200: BankAccountListResponseSchema, 401: DisbursementErrorSchema },
    },
  )
  .post(
    "/bank-accounts",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaigner = await findOwnCampaigner(user.id);
      if (!campaigner) {
        set.status = 422;
        return { error: "no_campaigner_profile" };
      }
      const [row] = await db
        .insert(bankAccounts)
        .values({
          campaignerId: campaigner.id,
          bankCode: body.bankCode,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountHolderName: body.accountHolderName,
        })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: just inserted
      return { id: row!.id };
    },
    {
      body: CreateBankAccountBodySchema,
      response: {
        200: t.Object({ id: t.String() }),
        401: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  );
```

- [ ] **Step 2: Mount the route** — find how `donationsRoute` is added to the main app in `apps/api/src/index.ts` and add `bankAccountsRoute` the same way.

- [ ] **Step 3: Write `bank-accounts.test.ts`**

```typescript
import { beforeAll, describe, expect, test } from "bun:test";
import { db, users, campaigners } from "@galangdana/db";
import { app } from "../index";

describe("bank accounts", () => {
  let sessionCookie: string;

  beforeAll(async () => {
    // Follow this codebase's existing established pattern for getting an
    // authenticated session cookie in a route test -- check
    // donations.test.ts or admin.test.ts's beforeAll for the exact
    // helper/sequence already used (likely: insert a user, insert a
    // session row directly, build the cookie header string) and mirror
    // it exactly rather than reinventing session creation here.
  });

  test("POST /bank-accounts requires a campaigner profile", async () => {
    const res = await app.handle(
      new Request("http://localhost/bank-accounts", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          bankCode: "bca",
          bankName: "Bank Central Asia",
          accountNumber: "1234567890",
          accountHolderName: "Test",
        }),
      }),
    );
    // Assert 200 if the test user has a campaigner profile, 422 if not --
    // set up the fixture so this test exercises the 200 path, and add a
    // SEPARATE test with a bare user (no campaigner row) for the 422 path.
    expect(res.status).toBe(200);
  });

  test("GET /bank-accounts returns only the authenticated campaigner's own accounts", async () => {
    // Create a second user+campaigner+bank account, confirm the first
    // session's GET does not include it.
  });

  test("GET /bank-accounts with no session returns 401", async () => {
    const res = await app.handle(new Request("http://localhost/bank-accounts"));
    expect(res.status).toBe(401);
  });
});
```

Fill in the `beforeAll` and the ownership-isolation test body by reading `apps/api/src/routes/donations.test.ts`'s or `admin.test.ts`'s existing session-fixture setup and matching it exactly — do not invent a new session-creation mechanism.

- [ ] **Step 4: Run tests, lint, typecheck**

```bash
cd apps/api && bun test src/routes/bank-accounts.test.ts --env-file=../../.env
cd /path/to/repo/root && bun run test --env-file=.env && bun run lint && bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/bank-accounts.ts apps/api/src/routes/bank-accounts.test.ts apps/api/src/index.ts
git commit -m "feat(api): add campaigner bank account endpoints"
```

---

## Task 6: Disbursement request creation, proof upload, and status read

**Files:**
- Create: `apps/api/src/routes/disbursements.ts`
- Modify: route-mounting file (same as Task 5)
- Test: `apps/api/src/routes/disbursements.test.ts`

**Interfaces:**
- Consumes: `campaigns.ts`'s `findOwnedCampaign` is confirmed private (not exported) as of this plan's writing — Step 1 below duplicates the ~10-line ownership-lookup helper locally as `findOwnedCampaignForDisbursement` rather than importing it; do not spend time re-checking this, just use the duplicated version as written. Also consumes `privateDocumentsS3`/`extractDocumentExtension` (from `apps/api/src/lib/media-s3.ts`), `donations`/`payments` schema (for the withdrawable-balance query).
- Produces: `disbursementsRoute` with `POST /campaigns/:id/disbursements`, `PATCH /disbursements/:id/bank-account`, `PATCH /disbursements/:id/detail`, `POST /disbursements/:id/proof/presign`, `POST /disbursements/:id/proof/confirm`, `GET /disbursements/:id`; a `computeWithdrawableAmount(campaignId)` helper other tasks (7, 8) also call.

- [ ] **Step 1: Write the withdrawable-balance helper and the route file's skeleton**

```typescript
import {
  BankAccountSchema,
  ConfirmDisbursementProofBodySchema,
  CreateDisbursementResponseSchema,
  DisbursementDetailSchema,
  DisbursementErrorSchema,
  PresignDisbursementProofBodySchema,
  PresignDisbursementProofResponseSchema,
  SaveDisbursementBankAccountBodySchema,
  SaveDisbursementDetailBodySchema,
} from "@galangdana/contracts";
import {
  bankAccounts,
  campaigners,
  campaigns,
  db,
  disbursementRequests,
  donations,
} from "@galangdana/db";
import { moneyToJSON } from "@galangdana/money";
import { and, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { extractDocumentExtension, privateDocumentsS3 } from "../lib/media-s3";
import { sessionDerive } from "../lib/session";

/**
 * withdrawable = collectedAmount - totalPlatformFees(paid donations) -
 * disbursedAmount - pendingDisbursementsAmount(otp_pending|requested|
 * approved). Distinct from displayAmount() in packages/db/schema/
 * campaigns.ts, which is the PUBLIC "Donasi tersedia" figure
 * (collectedAmount - disbursedAmount only) and is never changed by this
 * plan. This is the server-side gate for how much a NEW disbursement
 * request may ask for.
 */
export async function computeWithdrawableAmount(campaignId: string): Promise<bigint> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return 0n;

  const [feesRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${donations.platformFee}), 0)` })
    .from(donations)
    .where(and(eq(donations.campaignId, campaignId), eq(donations.status, "paid")));
  const totalFees = BigInt(feesRow?.total ?? "0");

  const [pendingRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${disbursementRequests.amount}), 0)` })
    .from(disbursementRequests)
    .where(
      and(
        eq(disbursementRequests.campaignId, campaignId),
        sql`${disbursementRequests.status} IN ('otp_pending', 'requested', 'approved')`,
      ),
    );
  const pending = BigInt(pendingRow?.total ?? "0");

  return campaign.collectedAmount - totalFees - campaign.disbursedAmount - pending;
}

async function findOwnedCampaignForDisbursement(campaignId: string, userId: string) {
  const [campaigner] = await db
    .select({ id: campaigners.id })
    .from(campaigners)
    .where(eq(campaigners.userId, userId));
  if (!campaigner) return null;
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.campaignerId, campaigner.id)));
  return campaign ?? null;
}

async function findOwnedDisbursement(disbursementId: string, userId: string) {
  const [row] = await db
    .select({ disbursement: disbursementRequests, campaign: campaigns })
    .from(disbursementRequests)
    .innerJoin(campaigns, eq(disbursementRequests.campaignId, campaigns.id))
    .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
    .where(and(eq(disbursementRequests.id, disbursementId), eq(campaigners.userId, userId)));
  return row ?? null;
}
```

(This duplicates a small ownership-lookup helper rather than importing `campaigns.ts`'s private `findOwnedCampaign` — confirm during implementation whether that function is exported; if it already is, import it instead of duplicating `findOwnedCampaignForDisbursement`.)

- [ ] **Step 2: `POST /campaigns/:id/disbursements`** (creates the draft row, entry point for the wizard)

```typescript
export const disbursementsRoute = new Elysia()
  .use(sessionDerive)
  .post(
    "/campaigns/:id/disbursements",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const campaign = await findOwnedCampaignForDisbursement(params.id, user.id);
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      if (campaign.status !== "active") {
        set.status = 409;
        return { error: "campaign_not_active" };
      }
      const [row] = await db
        .insert(disbursementRequests)
        .values({ campaignId: campaign.id })
        .returning();
      // biome-ignore lint/style/noNonNullAssertion: just inserted
      return { id: row!.id };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: CreateDisbursementResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 3: `PATCH /disbursements/:id/bank-account` and `PATCH /disbursements/:id/detail`**

```typescript
  .patch(
    "/disbursements/:id/bank-account",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      const [bankAccount] = await db
        .select()
        .from(bankAccounts)
        .where(eq(bankAccounts.id, body.bankAccountId));
      // Ownership of the bank account itself is checked via its
      // campaignerId matching this campaign's campaignerId -- reuse the
      // campaigner id already resolved inside findOwnedDisbursement's
      // join rather than a second round-trip; adjust
      // findOwnedDisbursement's return shape to also include
      // campaigners.id if not already present, or re-select it here.
      if (!bankAccount) {
        set.status = 422;
        return { error: "bank_account_not_found" };
      }
      await db
        .update(disbursementRequests)
        .set({ bankAccountId: bankAccount.id, updatedAt: new Date() })
        .where(eq(disbursementRequests.id, row.disbursement.id));
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveDisbursementBankAccountBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
  .patch(
    "/disbursements/:id/detail",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      const amount = BigInt(body.amountStr);
      if (amount <= 0n) {
        set.status = 422;
        return { error: "invalid_amount" };
      }
      const withdrawable = await computeWithdrawableAmount(row.campaign.id);
      if (amount > withdrawable) {
        set.status = 422;
        return { error: "amount_exceeds_withdrawable_balance" };
      }
      await db
        .update(disbursementRequests)
        .set({
          type: body.type,
          amount,
          currency: row.campaign.currency,
          narrative: body.narrative,
          updatedAt: new Date(),
        })
        .where(eq(disbursementRequests.id, row.disbursement.id));
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: SaveDisbursementDetailBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 4: proof presign/confirm**, mirroring `campaigns.ts`'s `/documents/presign` and `/documents/confirm` exactly (same object-key-prefix-match check on confirm):

```typescript
  .post(
    "/disbursements/:id/proof/presign",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      const ext = extractDocumentExtension(body.fileName);
      if (!ext) {
        set.status = 422;
        return { error: "unsupported_file_type" };
      }
      const objectKey = `disbursements/${row.disbursement.id}/proof/${crypto.randomUUID()}.${ext}`;
      const expiresInSeconds = 300;
      const uploadUrl = privateDocumentsS3
        .file(objectKey)
        .presign({ method: "PUT", expiresIn: expiresInSeconds });
      return { uploadUrl, objectKey, expiresInSeconds };
    },
    {
      params: t.Object({ id: t.String() }),
      body: PresignDisbursementProofBodySchema,
      response: {
        200: PresignDisbursementProofResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
  .post(
    "/disbursements/:id/proof/confirm",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      if (!body.objectKey.startsWith(`disbursements/${row.disbursement.id}/proof/`)) {
        set.status = 400;
        return { error: "object_key_mismatch" };
      }
      await db
        .update(disbursementRequests)
        .set({ proofObjectKey: body.objectKey, updatedAt: new Date() })
        .where(eq(disbursementRequests.id, row.disbursement.id));
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: ConfirmDisbursementProofBodySchema,
      response: {
        200: t.Object({ success: t.Boolean() }),
        400: DisbursementErrorSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 5: `GET /disbursements/:id`**

```typescript
  .get(
    "/disbursements/:id",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      const withdrawable = await computeWithdrawableAmount(row.campaign.id);
      return {
        id: row.disbursement.id,
        campaignId: row.campaign.id,
        bankAccountId: row.disbursement.bankAccountId,
        type: row.disbursement.type,
        amount: row.disbursement.amount
          ? moneyToJSON({ amount: row.disbursement.amount, currency: row.campaign.currency })
          : null,
        narrative: row.disbursement.narrative,
        proofObjectKey: row.disbursement.proofObjectKey,
        status: row.disbursement.status,
        otpVerifiedAt: row.disbursement.otpVerifiedAt?.toISOString() ?? null,
        rejectedReason: row.disbursement.rejectedReason,
        payoutRef: row.disbursement.payoutRef,
        paidAt: row.disbursement.paidAt?.toISOString() ?? null,
        withdrawableAmount: moneyToJSON({ amount: withdrawable, currency: row.campaign.currency }),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: DisbursementDetailSchema, 401: DisbursementErrorSchema, 404: DisbursementErrorSchema },
    },
  );
```

- [ ] **Step 6: Mount `disbursementsRoute`** in the same file Task 5 modified.

- [ ] **Step 7: Write `disbursements.test.ts`**

Cover, against the real Elysia app + real Postgres (this codebase's established convention, no mocks):
- `POST /campaigns/:id/disbursements` succeeds for an owned `active` campaign, 409s for a non-`active` one, 404s for someone else's campaign.
- `PATCH .../detail` rejects an amount exceeding the withdrawable balance (create a paid donation first via the real `POST /donations` + webhook flow, matching Task 4/5's own test setup style from Phase 5, so `collectedAmount`/`platformFee` are real, not hand-inserted).
- `PATCH .../detail` on a non-`draft` disbursement 409s.
- **The withdrawable-balance-under-two-in-flight-requests case**: create one paid donation, create two disbursement drafts against the same campaign, save detail on the first for most of the withdrawable amount (still `draft`, not yet `otp_pending`/`requested` — per the constraint list, `pendingDisbursementsAmount` counts `otp_pending|requested|approved`, NOT `draft`), confirm the second CAN still request the same amount (proving `draft` rows correctly don't reserve funds) — then manually transition the first to `requested` status via a direct DB update (simulating Task 7's later transition, which doesn't exist yet in this task) and confirm a third disbursement request now correctly sees a reduced withdrawable balance. This is the balance-formula "verify against real data" deliverable this plan exists to satisfy — do not skip it or reduce it to a single-request happy-path test.
- Proof presign/confirm: object-key-prefix-mismatch returns 400 (mirroring `campaigns.test.ts`'s existing equivalent test).
- `GET /disbursements/:id` 404s identically for nonexistent vs. someone-else's-disbursement (ownership-scoped 404-not-403, verify both cases explicitly).

- [ ] **Step 8: Run tests, lint, typecheck**

```bash
cd apps/api && bun test src/routes/disbursements.test.ts --env-file=../../.env
cd /path/to/repo/root && bun run test --env-file=.env && bun run lint && bun run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/disbursements.ts apps/api/src/routes/disbursements.test.ts apps/api/src/index.ts
git commit -m "feat(api): add disbursement request creation, proof upload, and withdrawable-balance gating"
```

---

## Task 7: Disbursement OTP request/verify and final submit

**Files:**
- Modify: `apps/api/src/routes/disbursements.ts`
- Modify: `apps/api/src/routes/disbursements.test.ts`

**Interfaces:**
- Consumes: `requestOtp`/`verifyOtp` from Task 3 (with `purpose: "disbursement"`), `users.phone` (to know which phone number to send the OTP to — the authenticated campaigner's own).
- Produces: `POST /disbursements/:id/otp/request`, `POST /disbursements/:id/otp/verify`, `POST /disbursements/:id/submit`.

- [ ] **Step 1: `POST /disbursements/:id/otp/request`** — validates the draft is complete, sends the code, transitions `draft → otp_pending`

```typescript
  .post(
    "/disbursements/:id/otp/request",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "draft") {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      if (!row.disbursement.bankAccountId || !row.disbursement.amount || !row.disbursement.type) {
        set.status = 422;
        return { error: "disbursement_incomplete" };
      }
      if (!user.phone) {
        set.status = 422;
        return { error: "no_phone_on_file" };
      }
      const otpResult = await requestOtp(user.phone, "disbursement");
      if (!otpResult.sent) {
        set.status = 422;
        return { error: otpResult.reason ?? "otp_send_failed" };
      }
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "otp_pending", updatedAt: new Date() })
        .where(and(eq(disbursementRequests.id, row.disbursement.id), eq(disbursementRequests.status, "draft")))
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "disbursement_not_editable" };
      }
      return { sent: true };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: RequestDisbursementOtpResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 2: `POST /disbursements/:id/otp/verify`** — sets `otpVerifiedAt`, stays in `otp_pending` (per this plan's Scope Note design: verification and final submit are separate steps, matching the summary page coming after otp in the master plan's own module map)

```typescript
  .post(
    "/disbursements/:id/otp/verify",
    async ({ user, params, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "otp_pending") {
        set.status = 409;
        return { error: "otp_not_requested" };
      }
      if (!user.phone) {
        set.status = 422;
        return { error: "no_phone_on_file" };
      }
      const result = await verifyOtp(user.phone, body.code, "disbursement");
      if (!result.success) {
        set.status = 422;
        return { error: result.reason ?? "otp_verification_failed" };
      }
      await db
        .update(disbursementRequests)
        .set({ otpVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(disbursementRequests.id, row.disbursement.id));
      return { verified: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: VerifyDisbursementOtpBodySchema,
      response: {
        200: VerifyDisbursementOtpResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
        422: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 3: `POST /disbursements/:id/submit`** — the summary page's final action, `otp_pending → requested` guarded by `otpVerifiedAt IS NOT NULL`

```typescript
  .post(
    "/disbursements/:id/submit",
    async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }
      const row = await findOwnedDisbursement(params.id, user.id);
      if (!row) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      if (row.disbursement.status !== "otp_pending" || !row.disbursement.otpVerifiedAt) {
        set.status = 409;
        return { error: "otp_not_verified" };
      }
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "requested", updatedAt: new Date() })
        .where(
          and(
            eq(disbursementRequests.id, row.disbursement.id),
            eq(disbursementRequests.status, "otp_pending"),
          ),
        )
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "otp_not_verified" };
      }
      return { status: "requested" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 4: Extend `disbursements.test.ts`** with:
- The full happy path: create → save bank account → save detail → upload proof → otp/request → otp/verify → submit → status is `requested`.
- `otp/verify` with an incorrect code does not advance status past `otp_pending` and does not set `otpVerifiedAt`.
- `submit` without a prior `otp/verify` (status stuck at `otp_pending`, `otpVerifiedAt` null) returns 409, not a silent success.
- `otp/request` on an incomplete draft (missing bank account, amount, or type) returns 422, not a crash.
- A login-purpose OTP challenge (from an unrelated `requestOtp(phone, "login")` call) cannot be used to satisfy `otp/verify` here — reuses Task 3's purpose-isolation guarantee, confirm it holds through this route too, not just at the `otp.ts` unit level.

- [ ] **Step 5: Run tests, lint, typecheck; commit**

```bash
cd apps/api && bun test src/routes/disbursements.test.ts --env-file=../../.env
cd /path/to/repo/root && bun run test --env-file=.env && bun run lint && bun run typecheck
git add apps/api/src/routes/disbursements.ts apps/api/src/routes/disbursements.test.ts
git commit -m "feat(api): add disbursement OTP confirmation and final submit"
```

---

## Task 8: Admin disbursement queue, approve/reject/pay

**Files:**
- Modify: `apps/api/src/routes/disbursements.ts` (or create `apps/api/src/routes/admin-disbursements.ts` if the file is getting large — implementer's judgment, matching how this codebase already sometimes splits admin endpoints into their own file, e.g. `admin.ts` vs `help.ts`'s admin section; check `help.ts` for which convention it followed before deciding)
- Modify: route-mounting file
- Test: extend or create the matching test file

**Interfaces:**
- Consumes: `checkAdmin` from `apps/api/src/lib/admin.ts`, `MockPaymentProvider.createPayout` from Task 4 (via a locally-duplicated `getProvider()` helper — `donations.ts`'s own version is confirmed not exported, see Step 5), `campaigns.disbursedAmount` (raw-SQL increment, matching the webhook handler's established `sql\`${campaigns.collectedAmount} + ${donation.amount}\`` pattern).
- Produces: `GET /admin/disbursements`, `GET /admin/disbursements/:id`, `POST /admin/disbursements/:id/approve`, `POST /admin/disbursements/:id/reject`, `POST /admin/disbursements/:id/pay`.

- [ ] **Step 1: `GET /admin/disbursements`** (queue, default-filtered to `requested`, mirroring `admin.ts`'s `GET /admin/campaigns` default-to-`pending_review` convention)

```typescript
  .get(
    "/admin/disbursements",
    async ({ user, query, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const status = (query.status ?? "requested") as (typeof disbursementStatusEnum.enumValues)[number];
      const rows = await db
        .select({
          id: disbursementRequests.id,
          campaignId: campaigns.id,
          campaignTitle: campaigns.title,
          type: disbursementRequests.type,
          amount: disbursementRequests.amount,
          currency: disbursementRequests.currency,
          status: disbursementRequests.status,
          createdAt: disbursementRequests.createdAt,
        })
        .from(disbursementRequests)
        .innerJoin(campaigns, eq(disbursementRequests.campaignId, campaigns.id))
        .where(eq(disbursementRequests.status, status))
        .orderBy(desc(disbursementRequests.createdAt));
      return {
        disbursements: rows.map((row) => ({
          id: row.id,
          campaignId: row.campaignId,
          campaignTitle: row.campaignTitle,
          // biome-ignore lint/style/noNonNullAssertion: status "requested" implies detail is filled
          type: row.type!,
          amount: moneyToJSON({ amount: row.amount ?? 0n, currency: row.currency ?? "IDR" }),
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
    {
      query: t.Object({ status: t.Optional(t.String()) }),
      response: {
        200: AdminDisbursementListResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 2: `GET /admin/disbursements/:id`** (detail, includes bank account + a presigned proof-view URL, mirroring `admin.ts`'s KTP/selfie presign pattern)

```typescript
  .get(
    "/admin/disbursements/:id",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const [row] = await db
        .select({
          disbursement: disbursementRequests,
          campaign: campaigns,
          bankAccount: bankAccounts,
        })
        .from(disbursementRequests)
        .innerJoin(campaigns, eq(disbursementRequests.campaignId, campaigns.id))
        .leftJoin(bankAccounts, eq(disbursementRequests.bankAccountId, bankAccounts.id))
        .where(eq(disbursementRequests.id, params.id));
      if (!row || !row.bankAccount) {
        set.status = 404;
        return { error: "disbursement_not_found" };
      }
      const proofViewUrl = row.disbursement.proofObjectKey
        ? privateDocumentsS3
            .file(row.disbursement.proofObjectKey)
            .presign({ method: "GET", expiresIn: 300 })
        : null;
      return {
        id: row.disbursement.id,
        campaignId: row.campaign.id,
        campaignTitle: row.campaign.title,
        bankAccount: {
          bankName: row.bankAccount.bankName,
          accountNumber: row.bankAccount.accountNumber,
          accountHolderName: row.bankAccount.accountHolderName,
          verifiedAt: row.bankAccount.verifiedAt?.toISOString() ?? null,
        },
        // biome-ignore lint/style/noNonNullAssertion: reached admin queue implies detail filled
        type: row.disbursement.type!,
        amount: moneyToJSON({
          amount: row.disbursement.amount ?? 0n,
          currency: row.disbursement.currency ?? "IDR",
        }),
        narrative: row.disbursement.narrative ?? "",
        proofViewUrl,
        status: row.disbursement.status,
        createdAt: row.disbursement.createdAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AdminDisbursementDetailSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        404: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 3: `POST /admin/disbursements/:id/approve`**

```typescript
  .post(
    "/admin/disbursements/:id/approve",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const now = new Date();
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "approved", approvedBy: user?.id, approvedAt: now, updatedAt: now })
        .where(and(eq(disbursementRequests.id, params.id), eq(disbursementRequests.status, "requested")))
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }
      return { status: "approved" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 4: `POST /admin/disbursements/:id/reject`**

```typescript
  .post(
    "/admin/disbursements/:id/reject",
    async ({ user, params, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const transitioned = await db
        .update(disbursementRequests)
        .set({ status: "rejected", rejectedReason: body.reason, updatedAt: new Date() })
        .where(and(eq(disbursementRequests.id, params.id), eq(disbursementRequests.status, "requested")))
        .returning();
      if (transitioned.length === 0) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }
      return { status: "rejected" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      body: AdminRejectDisbursementBodySchema,
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  )
```

- [ ] **Step 5: `POST /admin/disbursements/:id/pay`** — the payout-execution action. Calls the provider BEFORE opening a transaction (matching Phase 5 Task 4's established `createCharge`-before-transaction pattern, for the same reason: a real provider adapter's call is a network call, don't hold a DB transaction open across it), then atomically transitions `approved → paid` and increments `campaigns.disbursedAmount` in one transaction.

```typescript
  .post(
    "/admin/disbursements/:id/pay",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const [row] = await db
        .select({ disbursement: disbursementRequests, bankAccount: bankAccounts })
        .from(disbursementRequests)
        .leftJoin(bankAccounts, eq(disbursementRequests.bankAccountId, bankAccounts.id))
        .where(eq(disbursementRequests.id, params.id));
      if (!row || row.disbursement.status !== "approved" || !row.bankAccount || !row.disbursement.amount) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }

      const provider = getProvider();
      const payout = await provider.createPayout({
        externalId: row.disbursement.id,
        amount: row.disbursement.amount,
        bankCode: row.bankAccount.bankCode,
        accountNumber: row.bankAccount.accountNumber,
        accountHolderName: row.bankAccount.accountHolderName,
        description: row.disbursement.narrative ?? "",
      });

      const now = new Date();
      const transitioned = await db.transaction(async (tx) => {
        const updated = await tx
          .update(disbursementRequests)
          .set({ status: "paid", payoutRef: payout.payoutId, paidAt: now, updatedAt: now })
          .where(and(eq(disbursementRequests.id, row.disbursement.id), eq(disbursementRequests.status, "approved")))
          .returning();
        if (updated.length === 0) {
          return false;
        }
        await tx
          .update(campaigns)
          .set({ disbursedAmount: sql`${campaigns.disbursedAmount} + ${row.disbursement.amount}` })
          .where(eq(campaigns.id, row.disbursement.campaignId));
        return true;
      });

      if (!transitioned) {
        set.status = 409;
        return { error: "invalid_disbursement_status" };
      }
      return { status: "paid" as const };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: DisbursementActionResponseSchema,
        401: DisbursementErrorSchema,
        403: DisbursementErrorSchema,
        409: DisbursementErrorSchema,
      },
    },
  );
```

`getProvider()` is confirmed NOT exported from `donations.ts` (checked directly during plan-writing) — duplicate the two-line helper here instead of importing it:

```typescript
const SERVER_KEY = process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev";
function getProvider() {
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}
```

(add the `MockPaymentProvider` import from `@galangdana/payments` to this file's import block.)

- [ ] **Step 6: Test — this task carries the plan's core "verify against real data" deliverable**

In the test file, write an end-to-end reconciliation test: create a campaign, drive one or more real donations to `paid` through the actual `POST /donations` + webhook flow (not hand-inserted rows), note `campaigns.collectedAmount` and the total `platformFee` collected, create and fully progress a disbursement request through `requested → approved → paid`, then assert:
- `campaigns.disbursedAmount` increased by exactly the disbursement's `amount`.
- A fresh `computeWithdrawableAmount(campaignId)` call afterward equals `collectedAmount - totalFees - disbursedAmount - 0` (no more pending, since this one is now `paid`) — confirming the formula holds after a real payout, not just in isolation.
- The public-display `displayAmount()` helper (import it from `@galangdana/db`) still returns `collectedAmount - disbursedAmount` unchanged — confirming this plan genuinely didn't touch that formula.

Also cover: `approve`/`reject`/`pay` all 409 on a status that doesn't match their guard (e.g. `pay` on a `requested`-not-yet-`approved` row); `pay` is idempotent-safe against a double-call (second call 409s, does not double-increment `disbursedAmount` — assert the exact final value, not just that it changed).

- [ ] **Step 7: Run tests, lint, typecheck; commit**

```bash
cd apps/api && bun test --env-file=../../.env
cd /path/to/repo/root && bun run test --env-file=.env && bun run lint && bun run typecheck
git add apps/api/src/routes/disbursements.ts apps/api/src/routes/disbursements.test.ts apps/api/src/index.ts
git commit -m "feat(api): add admin disbursement queue, approve/reject, and payout execution"
```

---

## Task 9: Public disbursement log endpoint

**Files:**
- Modify: `apps/api/src/routes/campaigns.ts` (public campaign-scoped endpoints already live here, e.g. `GET /campaigns/:slug`; add this alongside them rather than in `disbursements.ts`, which is otherwise session/admin-gated)
- Test: `apps/api/src/routes/campaigns.test.ts`

**Interfaces:**
- Consumes: `disbursementRequests`, `campaigns` (by slug).
- Produces: `GET /campaigns/:slug/disbursements`.

- [ ] **Step 1: Add the endpoint**

```typescript
  .get(
    "/campaigns/:slug/disbursements",
    async ({ params, set }) => {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.slug, params.slug));
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      const rows = await db
        .select()
        .from(disbursementRequests)
        .where(and(eq(disbursementRequests.campaignId, campaign.id), eq(disbursementRequests.status, "paid")))
        .orderBy(desc(disbursementRequests.paidAt));
      return {
        disbursements: rows.map((row) => ({
          // biome-ignore lint/style/noNonNullAssertion: status "paid" implies these are set
          type: row.type!,
          amount: moneyToJSON({ amount: row.amount!, currency: row.currency! }),
          narrative: row.narrative ?? "",
          paidAt: row.paidAt!.toISOString(),
        })),
      };
    },
    {
      params: t.Object({ slug: t.String() }),
      response: { 200: PublicDisbursementLogResponseSchema, 404: CampaignErrorSchema },
    },
  )
```

Add this route to the existing chained `.get(...)` sequence in `campaigns.ts` (find the file's existing route-mounting pattern — it's one long `.use(...).get(...).get(...).post(...)` chain, per every earlier route file read during this plan's research) and add the two new imports (`disbursementRequests` from `@galangdana/db`, `PublicDisbursementLogResponseSchema` from `@galangdana/contracts`) to the file's existing import blocks.

- [ ] **Step 2: Test**

Add to `campaigns.test.ts`: an unpaid (`draft`/`requested`/`approved`) disbursement never appears in this endpoint's response; a `paid` one does, with the exact fields (`type`, `amount`, `narrative`, `paidAt`) and explicitly asserting `bankAccountId`/account details are NOT present anywhere in the response body (stringify the response and confirm the account number does not appear as a substring, as a belt-and-suspenders privacy check beyond just "the schema doesn't have the field").

- [ ] **Step 3: Run tests, lint, typecheck; commit**

```bash
cd apps/api && bun test src/routes/campaigns.test.ts --env-file=../../.env
cd /path/to/repo/root && bun run test --env-file=.env && bun run lint && bun run typecheck
git add apps/api/src/routes/campaigns.ts apps/api/src/routes/campaigns.test.ts
git commit -m "feat(api): add public per-campaign disbursement log endpoint"
```

---

## Task 10: Frontend — wizard entry point + rekening page

**Files:**
- Modify: `apps/web/src/routes/(campaigner)/dashboard/campaigns/+page.svelte`
- Create: `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/+page.server.ts`
- Create: `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/[disbursementId]/rekening/+page.server.ts`
- Create: `apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/[disbursementId]/rekening/+page.svelte`
- Test: `.../rekening/page.render.test.ts`

**Interfaces:**
- Consumes: `POST /campaigns/:id/disbursements`, `GET /bank-accounts`, `POST /bank-accounts`, `PATCH /disbursements/:id/bank-account`.

- [ ] **Step 1: Add the entry link** to the campaigns list page — inside the existing `{#each data.campaigns as campaign}` block, add (alongside the existing `needs_revision` conditional link):

```svelte
{#if campaign.status === "active"}
  <a
    href="/dashboard/campaigns/{campaign.id}/pencairan"
    class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-primary-dark"
  >
    Ajukan Pencairan
  </a>
{/if}
```

- [ ] **Step 2: `pencairan/+page.server.ts`** — creates the draft row, redirects into the id-scoped wizard, mirroring `create/select-category`'s `createDraft()` pattern but server-side (a `load` doing a POST-on-visit is unusual — use a form `action` triggered by a zero-field auto-submitting form, OR do the POST from a thin `+page.svelte` exactly like `select-category` does client-side. Follow the client-side pattern for consistency with the codebase's one existing precedent):

Actually create this as a thin client-triggered page, not a server load-with-side-effect (a GET request must not have a side effect):

```typescript
// +page.server.ts
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
};
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { onMount } from "svelte";
import { page } from "$app/state";

let error = $state<string | null>(null);

onMount(async () => {
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data, error: apiError } = await (api.campaigns as any)({
    id: page.params.id,
  }).disbursements.post();
  if (apiError || !data) {
    error = "Gagal memulai pengajuan pencairan. Pastikan campaign Anda sedang aktif.";
    return;
  }
  await goto(`/dashboard/campaigns/${page.params.id}/pencairan/${data.id}/rekening`);
});
</script>

{#if error}
  <p class="mx-auto max-w-sm py-12 text-center font-sans text-sm text-red-600">{error}</p>
{:else}
  <p class="mx-auto max-w-sm py-12 text-center font-sans text-sm text-neutral-500">Memuat...</p>
{/if}
```

- [ ] **Step 3: `[disbursementId]/rekening/+page.server.ts`**

```typescript
import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { BankAccountListResponse } from "@galangdana/contracts";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  const client = createServerApiClient(sessionToken);
  // biome-ignore lint/suspicious/noExplicitAny: Eden bracket-notation cast for a kebab-case segment
  const { data, error: apiError } = (await (client as any)["bank-accounts"].get()) as Treaty.TreatyResponse<{
    200: BankAccountListResponse;
    401: { error: string };
  }>;
  if (apiError?.status === 401 || !data) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  return { bankAccounts: data.bankAccounts };
};
```

- [ ] **Step 4: `[disbursementId]/rekening/+page.svelte`** — list existing verified/unverified bank accounts as selectable, plus a form to add a new one; on selecting or adding, `PATCH` the disbursement and navigate to `upload`:

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { page } from "$app/state";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let selectedId = $state<string | null>(data.bankAccounts[0]?.id ?? null);
let showNewForm = $state(data.bankAccounts.length === 0);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let bankCode = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let bankName = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let accountNumber = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let accountHolderName = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function proceed() {
  error = null;
  submitting = true;
  let bankAccountId = selectedId;

  if (showNewForm) {
    // biome-ignore lint/suspicious/noExplicitAny: Eden bracket-notation cast
    const { data: created, error: createError } = await (api["bank-accounts"] as any).post({
      bankCode,
      bankName,
      accountNumber,
      accountHolderName,
    });
    if (createError || !created) {
      error = "Gagal menyimpan rekening.";
      submitting = false;
      return;
    }
    bankAccountId = created.id;
  }

  if (!bankAccountId) {
    error = "Pilih atau tambahkan rekening bank.";
    submitting = false;
    return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: patchError } = await (api.disbursements as any)({
    id: page.params.disbursementId,
  })["bank-account"].patch({ bankAccountId });
  submitting = false;
  if (patchError) {
    error = "Gagal menyimpan rekening ke pengajuan pencairan.";
    return;
  }
  await goto(
    `/dashboard/campaigns/${page.params.id}/pencairan/${page.params.disbursementId}/upload`,
  );
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Rekening Pencairan</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  {#if data.bankAccounts.length > 0}
    <fieldset class="mb-4 space-y-2">
      {#each data.bankAccounts as account (account.id)}
        <label class="flex items-center gap-2 font-sans text-sm">
          <input
            type="radio"
            name="bankAccount"
            value={account.id}
            checked={selectedId === account.id && !showNewForm}
            onchange={() => {
              selectedId = account.id;
              showNewForm = false;
            }}
          />
          {account.bankName} - {account.accountNumber} ({account.accountHolderName})
          {#if !account.verifiedAt}<span class="text-amber-600">belum diverifikasi</span>{/if}
        </label>
      {/each}
    </fieldset>
    <button
      type="button"
      class="mb-4 font-sans text-sm text-primary underline"
      onclick={() => (showNewForm = !showNewForm)}
    >
      {showNewForm ? "Batal tambah rekening baru" : "+ Tambah rekening baru"}
    </button>
  {/if}

  {#if showNewForm}
    <FormField label="Kode Bank" id="bankCode">
      <TextInput id="bankCode" bind:value={bankCode} placeholder="bca" />
    </FormField>
    <FormField label="Nama Bank" id="bankName">
      <TextInput id="bankName" bind:value={bankName} placeholder="Bank Central Asia" />
    </FormField>
    <FormField label="Nomor Rekening" id="accountNumber">
      <TextInput id="accountNumber" bind:value={accountNumber} />
    </FormField>
    <FormField label="Nama Pemilik Rekening" id="accountHolderName">
      <TextInput id="accountHolderName" bind:value={accountHolderName} />
    </FormField>
  {/if}

  <Button onclick={proceed} disabled={submitting}>Lanjutkan</Button>
</div>
```

- [ ] **Step 5: `page.render.test.ts`** — mirror the render-test structure of `donation-amount/page.render.test.ts` (mock `$app/navigation`'s `goto`, mock `$env/dynamic/public`, spy on `global.fetch`): test that selecting an existing account and clicking "Lanjutkan" PATCHes `/disbursements/:id/bank-account` and navigates to `upload`; test that the new-account form path POSTs to `/bank-accounts` first, then PATCHes, then navigates; test that submitting neither an existing selection nor a filled new-account form shows the validation error and does not navigate.

- [ ] **Step 6: Run tests, lint, typecheck; commit**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
git add "apps/web/src/routes/(campaigner)/dashboard/campaigns/+page.svelte" \
  "apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan"
git commit -m "feat(web): add pencairan wizard entry point and rekening step"
```

---

## Task 11: Frontend — upload page

**Files:**
- Create: `.../[disbursementId]/upload/+page.server.ts`
- Create: `.../[disbursementId]/upload/+page.svelte`
- Test: `.../upload/page.render.test.ts`

**Interfaces:**
- Consumes: `POST /disbursements/:id/proof/presign`, `POST /disbursements/:id/proof/confirm`.

- [ ] **Step 1: `+page.server.ts`** — same session-guard `load` shape as Task 10's rekening page (no data fetch needed beyond the auth check; copy that pattern exactly).

- [ ] **Step 2: `+page.svelte`** — mirror the file-upload flow already proven in `dashboard/campaigns/[id]/revise/+page.svelte` (presign → PUT to `uploadUrl` → confirm), adapted to a single proof file with an inline preview after a successful upload:

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { page } from "$app/state";
import { Button } from "@galangdana/ui";

let file = $state<File | null>(null);
let uploaded = $state(false);
let error = $state<string | null>(null);
let uploading = $state(false);

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  file = input.files?.[0] ?? null;
  uploaded = false;
}

async function upload() {
  if (!file) return;
  error = null;
  uploading = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const disbursementClient = (api.disbursements as any)({ id: page.params.disbursementId });
  const { data: presign, error: presignError } = await disbursementClient.proof.presign.post({
    fileName: file.name,
  });
  if (presignError || !presign) {
    error = "Gagal menyiapkan unggahan.";
    uploading = false;
    return;
  }
  const putRes = await fetch(presign.uploadUrl, { method: "PUT", body: file });
  if (!putRes.ok) {
    error = "Gagal mengunggah berkas.";
    uploading = false;
    return;
  }
  const { error: confirmError } = await disbursementClient.proof.confirm.post({
    objectKey: presign.objectKey,
  });
  uploading = false;
  if (confirmError) {
    error = "Gagal menyimpan berkas.";
    return;
  }
  uploaded = true;
}

async function proceed() {
  if (!uploaded) {
    error = "Unggah bukti kebutuhan dana terlebih dahulu.";
    return;
  }
  await goto(
    `/dashboard/campaigns/${page.params.id}/pencairan/${page.params.disbursementId}/detail`,
  );
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Bukti Kebutuhan Dana</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onchange={onFileChange} class="mb-4" />

  {#if file && !uploaded}
    <Button onclick={upload} disabled={uploading}>Unggah</Button>
  {/if}
  {#if uploaded}
    <p class="mb-4 font-sans text-sm text-green-700">Berkas berhasil diunggah.</p>
  {/if}

  <Button onclick={proceed} disabled={!uploaded}>Lanjutkan</Button>
</div>
```

- [ ] **Step 3: `page.render.test.ts`** — mirror the multi-fetch-mock style already proven in `revise/page.render.test.ts`'s "uploading two different documents" test (a single `vi.spyOn(global, "fetch").mockImplementation` branching on URL/method): test the presign→PUT→confirm sequence hits the right three calls in order with the right bodies, test "Lanjutkan" is disabled/blocked before `uploaded` is true, test it navigates to `detail` after a successful upload+click.

- [ ] **Step 4: Run tests, lint, typecheck; commit**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
git add "apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/[disbursementId]/upload"
git commit -m "feat(web): add pencairan proof-upload step"
```

---

## Task 12: Frontend — detail page

**Files:**
- Create: `.../[disbursementId]/detail/+page.server.ts`
- Create: `.../[disbursementId]/detail/+page.svelte`
- Test: `.../detail/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /disbursements/:id` (for the live `withdrawableAmount` to display), `PATCH /disbursements/:id/detail`.

- [ ] **Step 1: `+page.server.ts`** — loads the disbursement (for `withdrawableAmount`), same session-guard + `createServerApiClient` pattern as Task 10's `rekening/+page.server.ts`, fetching `GET /disbursements/:id` instead of `/bank-accounts`.

- [ ] **Step 2: `+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { page } from "$app/state";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let type = $state<"partial" | "final">("partial");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let amountStr = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let narrative = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function proceed() {
  error = null;
  if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
    error = "Masukkan nominal yang valid.";
    return;
  }
  if (!narrative.trim()) {
    error = "Jelaskan penggunaan dana.";
    return;
  }
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: apiError } = await (api.disbursements as any)({
    id: page.params.disbursementId,
  }).detail.patch({ type, amountStr, narrative });
  submitting = false;
  if (apiError?.value && "error" in apiError.value && apiError.value.error === "amount_exceeds_withdrawable_balance") {
    error = "Nominal melebihi saldo yang dapat dicairkan.";
    return;
  }
  if (apiError) {
    error = "Gagal menyimpan detail pencairan.";
    return;
  }
  await goto(`/dashboard/campaigns/${page.params.id}/pencairan/${page.params.disbursementId}/otp`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-2 font-sans text-xl font-bold text-neutral-900">Detail Pencairan</h1>
  <p class="mb-6 font-sans text-sm text-neutral-600">
    Saldo dapat dicairkan: Rp{data.disbursement.withdrawableAmount.amount}
  </p>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <fieldset class="mb-4 space-y-2">
    <label class="flex items-center gap-2 font-sans text-sm">
      <input type="radio" name="type" checked={type === "partial"} onchange={() => (type = "partial")} />
      Pencairan Sebagian
    </label>
    <label class="flex items-center gap-2 font-sans text-sm">
      <input type="radio" name="type" checked={type === "final"} onchange={() => (type = "final")} />
      Pencairan Akhir
    </label>
  </fieldset>

  <FormField label="Nominal Pencairan" id="amount">
    <TextInput id="amount" bind:value={amountStr} inputmode="numeric" placeholder="1000000" />
  </FormField>

  <FormField label="Keterangan Penggunaan Dana" id="narrative">
    <TextInput id="narrative" bind:value={narrative} placeholder="Untuk biaya pengobatan..." />
  </FormField>

  <Button onclick={proceed} disabled={submitting}>Lanjutkan</Button>
</div>
```

(Check `packages/ui`'s `TextInput` component — if it doesn't support multi-line text, use a plain `<textarea>` for `narrative` instead, matching whatever the `revise` page already does for its `story` field.)

- [ ] **Step 3: `page.render.test.ts`** — the withdrawable balance renders from `data`; an invalid (non-numeric or zero) amount blocks submission with the local validation message and makes no fetch call; a `PATCH` response with `error: "amount_exceeds_withdrawable_balance"` renders that specific message (mock `fetch` to return that exact error body); a successful `PATCH` navigates to `otp`.

- [ ] **Step 4: Run tests, lint, typecheck; commit**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
git add "apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/[disbursementId]/detail"
git commit -m "feat(web): add pencairan detail step with withdrawable-balance validation"
```

---

## Task 13: Frontend — otp page

**Files:**
- Create: `.../[disbursementId]/otp/+page.server.ts`
- Create: `.../[disbursementId]/otp/+page.svelte`
- Test: `.../otp/page.render.test.ts`

**Interfaces:**
- Consumes: `POST /disbursements/:id/otp/request`, `POST /disbursements/:id/otp/verify`.

- [ ] **Step 1: `+page.server.ts`** — same session-guard `load` as Task 11's upload page (no extra data needed).

- [ ] **Step 2: `+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { page } from "$app/state";
import { Button, FormField, TextInput } from "@galangdana/ui";

let sent = $state(false);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let code = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function requestCode() {
  error = null;
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const disbursementClient = (api.disbursements as any)({ id: page.params.disbursementId });
  const { error: apiError } = await disbursementClient.otp.request.post();
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim kode OTP.";
    return;
  }
  sent = true;
}

async function verifyCode() {
  error = null;
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const disbursementClient = (api.disbursements as any)({ id: page.params.disbursementId });
  const { data, error: apiError } = await disbursementClient.otp.verify.post({ code });
  submitting = false;
  if (apiError || !data?.verified) {
    error = "Kode OTP salah atau kedaluwarsa.";
    return;
  }
  await goto(
    `/dashboard/campaigns/${page.params.id}/pencairan/${page.params.disbursementId}/summary`,
  );
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Konfirmasi OTP</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  {#if !sent}
    <p class="mb-4 font-sans text-sm text-neutral-600">
      Kami akan mengirimkan kode konfirmasi ke nomor telepon Anda.
    </p>
    <Button onclick={requestCode} disabled={submitting}>Kirim Kode</Button>
  {:else}
    <FormField label="Kode OTP" id="code">
      <TextInput id="code" bind:value={code} inputmode="numeric" placeholder="123456" />
    </FormField>
    <Button onclick={verifyCode} disabled={submitting}>Verifikasi</Button>
  {/if}
</div>
```

- [ ] **Step 3: `page.render.test.ts`** — "Kirim Kode" calls `otp/request` and reveals the code input; a failed `otp/verify` (mock a non-`verified` response) shows the error and does not navigate; a successful verify navigates to `summary`.

- [ ] **Step 4: Run tests, lint, typecheck; commit**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
git add "apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/[disbursementId]/otp"
git commit -m "feat(web): add pencairan OTP confirmation step"
```

---

## Task 14: Frontend — summary and in-process pages

**Files:**
- Create: `.../[disbursementId]/summary/+page.server.ts`
- Create: `.../[disbursementId]/summary/+page.svelte`
- Create: `.../[disbursementId]/in-process/+page.server.ts`
- Create: `.../[disbursementId]/in-process/+page.svelte`
- Test: `.../summary/page.render.test.ts`, `.../in-process/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /disbursements/:id` (both pages), `POST /disbursements/:id/submit` (summary only).

- [ ] **Step 1: `summary/+page.server.ts`** — same `GET /disbursements/:id` load pattern as Task 12's detail page.

- [ ] **Step 2: `summary/+page.svelte`** — a read-only review of every field, plus the final submit button:

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { page } from "$app/state";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let error = $state<string | null>(null);
let submitting = $state(false);

async function submit() {
  error = null;
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: apiError } = await (api.disbursements as any)({
    id: page.params.disbursementId,
  }).submit.post();
  submitting = false;
  if (apiError) {
    error = "Gagal mengajukan pencairan. Pastikan Anda sudah memverifikasi OTP.";
    return;
  }
  await goto(
    `/dashboard/campaigns/${page.params.id}/pencairan/${page.params.disbursementId}/in-process`,
  );
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Ringkasan Pencairan</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <dl class="mb-6 space-y-2 font-sans text-sm">
    <div><dt class="text-neutral-500">Jenis</dt><dd>{data.disbursement.type}</dd></div>
    <div>
      <dt class="text-neutral-500">Nominal</dt>
      <dd>Rp{data.disbursement.amount?.amount}</dd>
    </div>
    <div><dt class="text-neutral-500">Keterangan</dt><dd>{data.disbursement.narrative}</dd></div>
  </dl>

  <Button onclick={submit} disabled={submitting}>Ajukan Pencairan</Button>
</div>
```

- [ ] **Step 3: `in-process/+page.server.ts`** — same `GET /disbursements/:id` load pattern, no submit action.

- [ ] **Step 4: `in-process/+page.svelte`** — a static status display, mirroring `donation/status/[id]/+page.svelte`'s "no polling, manual refresh" precedent exactly (this plan carries the same explicit constraint — no `apps/worker`, so there's nothing async to poll for beyond what an admin action changes):

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const STATUS_LABELS: Record<string, string> = {
  requested: "Menunggu peninjauan admin",
  approved: "Disetujui, menunggu pencairan",
  rejected: "Ditolak",
  paid: "Dana telah dicairkan",
  failed: "Pencairan gagal",
};
</script>

<div class="mx-auto max-w-sm py-12 text-center">
  <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Status Pencairan</h1>
  <p class="mb-2 font-sans text-lg">{STATUS_LABELS[data.disbursement.status] ?? data.disbursement.status}</p>
  {#if data.disbursement.status === "rejected" && data.disbursement.rejectedReason}
    <p class="font-sans text-sm text-red-600">{data.disbursement.rejectedReason}</p>
  {/if}
  {#if data.disbursement.status === "paid"}
    <p class="font-sans text-sm text-neutral-600">Referensi: {data.disbursement.payoutRef}</p>
  {/if}
  <p class="mt-6 font-sans text-xs text-neutral-500">Muat ulang halaman untuk memperbarui status.</p>
</div>
```

- [ ] **Step 5: Tests** — summary: renders the loaded fields, clicking submit calls `POST .../submit` and navigates to `in-process` on success, shows the error message on failure without navigating. In-process: renders each status label correctly (parametrize over `requested`/`approved`/`paid`/`rejected` fixtures), shows the rejection reason only when `rejected`, shows the payout ref only when `paid`.

- [ ] **Step 6: Run tests, lint, typecheck; commit**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
git add "apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/[disbursementId]/summary" \
  "apps/web/src/routes/(campaigner)/dashboard/campaigns/[id]/pencairan/[disbursementId]/in-process"
git commit -m "feat(web): add pencairan summary submit and in-process status pages"
```

---

## Task 15: Frontend — admin disbursement queue page

**Files:**
- Create: `apps/web/src/routes/(admin)/disbursements/+page.server.ts`
- Create: `apps/web/src/routes/(admin)/disbursements/+page.svelte`
- Test: `apps/web/src/routes/(admin)/disbursements/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /admin/disbursements`, `POST /admin/disbursements/:id/approve`, `POST /admin/disbursements/:id/reject`, `POST /admin/disbursements/:id/pay`.

Check how the existing `(admin)/dashboard` or `(admin)/help-articles`/`(admin)/support-tickets` pages (from Phase 4) handle the admin-role redirect — mirror that exact `+page.server.ts` guard pattern (likely: check session, check `user.role === "admin"`, redirect/403 otherwise) rather than re-deriving it.

- [ ] **Step 1: `+page.server.ts`** — loads the `requested`-status queue by default (matching the admin API's own default), using the established admin-guard pattern from Phase 3/4's admin pages.

- [ ] **Step 2: `+page.svelte`** — a list of pending disbursement requests with campaign title, type, amount, and Approve/Reject/Pay buttons contextual to status (Approve+Reject visible only for `requested`; Pay visible only for `approved`) — mirror `(admin)/support-tickets/+page.svelte`'s list-with-inline-actions structure (Phase 4) rather than inventing new list-page conventions.

- [ ] **Step 3: Tests** — renders the queue; clicking Approve calls the approve endpoint and removes/updates that row; clicking Reject prompts for and sends a reason; clicking Pay calls the pay endpoint. Non-admin session redirects/403s (matching however the Phase 3/4 admin pages already test this exact guard — mirror that test, don't invent a new assertion style).

- [ ] **Step 4: Run tests, lint, typecheck; commit**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
git add "apps/web/src/routes/(admin)/disbursements"
git commit -m "feat(web): add admin disbursement review queue"
```

---

## Task 16: Frontend — public disbursement log page

**Files:**
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/pencairan-dana/+page.server.ts`
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/pencairan-dana/+page.svelte`
- Test: `.../pencairan-dana/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /campaigns/:slug/disbursements` (public, no session needed — matches the donation-amount page's plain `api.campaigns` client-side/universal-load precedent, not `createServerApiClient`).

- [ ] **Step 1: `+page.server.ts`** — a plain public `load`, mirroring `donation-amount/+page.server.ts`'s shape exactly but calling the disbursements endpoint instead:

```typescript
import { api } from "$lib/api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data, error: apiError } = await (api.campaigns as any)({
    slug: params.slug,
  }).disbursements.get();
  if (apiError?.status === 404 || !data) {
    error(404, "Campaign tidak ditemukan");
  }
  return { disbursements: data.disbursements };
};
```

- [ ] **Step 2: `+page.svelte`**

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const TYPE_LABELS: Record<string, string> = { partial: "Pencairan Sebagian", final: "Pencairan Akhir" };
</script>

<div class="mx-auto max-w-2xl px-4 py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Riwayat Pencairan Dana</h1>

  {#if data.disbursements.length === 0}
    <p class="font-sans text-sm text-neutral-600">Belum ada pencairan dana untuk campaign ini.</p>
  {:else}
    <ul class="space-y-4">
      {#each data.disbursements as item, i (i)}
        <li class="rounded-sm border border-neutral-200 p-4">
          <p class="font-sans text-sm font-medium text-neutral-900">
            {TYPE_LABELS[item.type] ?? item.type} - Rp{item.amount.amount}
          </p>
          <p class="font-sans text-xs text-neutral-500">{new Date(item.paidAt).toLocaleDateString("id-ID")}</p>
          <p class="mt-2 font-sans text-sm text-neutral-700">{item.narrative}</p>
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

- [ ] **Step 3: Tests** — renders an empty state; renders one or more paid disbursements with correct formatting; a 404 campaign slug renders SvelteKit's error page (matching `donation-amount/page.render.test.ts`'s existing 404 test, if it has one — check and mirror).

- [ ] **Step 4: Run tests, lint, typecheck; commit**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
git add "apps/web/src/routes/(consumer)/campaign/[slug]/pencairan-dana"
git commit -m "feat(web): add public per-campaign disbursement log page"
```

---

## Self-Review Notes (for the controller, not a task)

- **Spec coverage:** every module-map item for Phase 6 is covered except the real Xendit adapter (ruled out of scope, Scope Note) and `apps/worker`/reconciler (ruled out of scope, Scope Note). The withdrawable-balance-formula verification is explicitly exercised in Task 6 Step 7 and Task 8 Step 6, not just implemented and hoped correct.
- **Type consistency check:** `PayoutInput`/`PayoutResult` field names in Task 4 are marked explicitly as a starting sketch pending the task's own required web research — every OTHER task's interfaces (schema columns, contract field names, route paths) are used identically everywhere they're referenced across tasks 1-16; re-verify this once Task 4 lands its real field names, since Task 8 Step 5 constructs a `PayoutInput` literal that must be updated to match whatever Task 4 actually ships.
- `findOwnedCampaign` in `campaigns.ts` was confirmed NOT exported (checked directly against the file during plan-writing) — Task 6 duplicates a local `findOwnedCampaignForDisbursement` helper rather than importing it; this is settled, not an open question for Task 6's implementer.
