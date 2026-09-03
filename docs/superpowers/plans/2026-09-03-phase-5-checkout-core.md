# Phase 5, Slice 1: Donation Checkout Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete donation-checkout FLOW — idempotent donation creation, a pluggable `PaymentProvider` adapter, real webhook signature verification, atomic payment-confirmation, and the checkout funnel UI — proven end-to-end against a mock payment provider, with the adapter boundary designed so a real Midtrans integration is a contained follow-up once sandbox credentials exist. This is "Checkout + Midtrans" narrowed to its first buildable slice; see "Scope note" below for what's deliberately deferred and why.

**Architecture:** New `packages/payments` package exports a `PaymentProvider` interface (`createCharge`, `parseWebhook`, `getStatus`, `createPayout`) matching the master plan's own architecture diagram, plus a `MockPaymentProvider` implementation that behaves like a real Bank-Transfer-VA provider (generates a VA number, accepts a simulated webhook, verifies signatures with the exact SHA512 scheme Midtrans documents) without any real network call. New `apps/api` routes: `POST /donations` (idempotent charge creation) and `POST /payments/webhook` (signature-verified, dedup'd, atomically transitions a donation to `paid`). New DB tables: `donations`, `payments`, `payment_events`, `idempotency_keys`, `allocation_policies`, `notifications_outbox`. New `apps/web` checkout funnel: donation amount → payment option → contribute (shows the VA number) → status page (polls until paid).

**Tech Stack:** SvelteKit 2 (adapter-node), ElysiaJS on Bun, Drizzle + Postgres, TypeBox contracts + Eden Treaty, Web Crypto (`crypto.subtle`) for HMAC signature verification.

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` (master plan — Phase 5's original scope, the "Payment architecture" section, the Domain Model's Money section, the Cross-cutting Concerns section, the Verification section's payment-integration bullet).

## Scope note — read this before anything else

The master plan's Phase 5 line is "Checkout + Midtrans — full funnel, 18 methods, idempotency keys, webhooks, reconciler, receipts via outbox, anti-fraud velocity limits shipping with cards. *First real rupiah.*" Checked against the actual codebase before writing this plan:

- No `donations`, `payments`, `payment_events`, `idempotency_keys`, `allocation_policies`, or `notifications_outbox` schema exists anywhere in `packages/db/src/schema/`.
- No `packages/payments` package exists. No `apps/worker` app exists at all — the master plan's own architecture diagram names both.
- No Midtrans (or any payment provider) credentials exist anywhere in `.env`. There is no sandbox access to build or test a real adapter against.
- `packages/money`'s bigint/currency/serialization infrastructure (promised since Phase 0) is real and solid — confirmed by reading `packages/money/src/`.
- `campaigns.collectedAmount` / `.disbursedAmount` / `.donationCount` already exist as denormalized columns with `availableAmount` derivation logic already written (`packages/db/src/schema/campaigns.ts`) — this phase needs to increment them, not create them.
- No `fundraisers` table exists (P2P fundraising isn't built yet) — donations in this slice are campaign-only.

Building all 18 payment methods, a real Midtrans HTTP adapter, and a reconciler worker in one slice is not realistic — this mirrors the exact lesson from Phase 2 needing a 2a/2c/2b split and Phase 4 needing its own scope split once real dependencies surfaced. This plan builds the smallest slice that is a **complete, real, working checkout flow**: one payment method (Bank Transfer Virtual Account — chosen because it's structurally representative of 8 of the master plan's 18 methods, and its charge/webhook shape is the one Midtrans's own docs describe most completely), built against a `PaymentProvider` interface with a mock implementation, so every piece of logic that doesn't depend on a live third party — idempotency, signature verification, deduplication, the atomic paid-transition, the checkout UI — is built and genuinely tested now.

### Explicitly Out of Scope (and why)

- **A real Midtrans HTTP adapter.** Blocked on missing sandbox credentials — there is nothing to build or test against. The `PaymentProvider` interface and `MockPaymentProvider`'s signature-verification code are written to match Midtrans's own documented wire format (SHA512 `order_id + status_code + gross_amount + server_key`) exactly, so a real `MidtransProvider` implementing the same interface is a contained follow-up task once credentials exist, not a redesign.
- **The other 17 payment methods** (GoPay, QRIS, DANA, LinkAja, ShopeePay, the other 7 VA banks, 3 manual-transfer methods, Credit Card). Each is a `createCharge` variant returning a different response shape (deeplink vs. QR string vs. VA number) against the *same* checkout flow this slice builds. Adding them is real but mechanical follow-up work once this slice's flow is proven, not a redesign.
- **The reconciler / `apps/worker`.** Its entire job is polling `provider.getStatus(orderId)` against the REAL provider for stuck `pending` payments — meaningless against a mock provider with no real settlement delay. Natural fast-follow alongside the real Midtrans adapter.
- **Anti-fraud velocity limits.** The master plan says these ship "with cards" — Credit Card isn't in this slice, so there's no card-testing surface yet to defend.
- **Real notification delivery** (email/push/WhatsApp). The master plan says notifications "land incrementally from Phase 5, when the first receipt needs sending" — this slice creates the `notifications_outbox` table and enqueues a `pending` row on payment confirmation (the "first receipt need" the master plan refers to), but does not build a consumer that actually sends anything. That's real follow-up work, not a redesign — the outbox pattern itself is what needed to exist first.
- **Prayers (Doa) written at donation time.** Phase 4 already ruled that Doa/Aamiin are deferred to a sub-phase inserted after this one, specifically because they need real donations to exist first. That sub-phase starts now that this plan makes donations real — it is not part of this plan.
- **Fundraiser total increments.** No `fundraisers` table exists yet; this slice increments campaign totals only.
- **Guest-donation claim-later flow** ("donate anonymously, bind later via verified phone/email"). This is donor-account territory (Phase 7); this slice supports guest donations (nullable `userId`) but not claiming them later.
- **A real `allocation_policies` business decision** (the actual platform fee percentage, zakat's 0% policy, org revenue share). This is a business/legal call, not an engineering one. This slice creates the `allocation_policies` table (the master plan's own domain model requires donations to read "allocation from policy") seeded with exactly one default row at **0% platform fee** — an explicit placeholder, not a business decision. Flagged for the project owner; change the seeded percentage whenever that decision is made, no schema change needed.

## Global Constraints

- **Money is bigint minor-unit rupiah, never float.** `donations.amount`, `payments.grossAmount` etc. are `bigint("...", { mode: "bigint" })` columns. The amount a webhook confirms is read from the server-side `payments` row, never trusted from any external payload beyond using it to compute the signature check.
- **The donation amount is read from the server-side record from the point of creation on — never re-read from the client at any later step.** `POST /donations` is the only place `body.amountStr` is trusted; every subsequent step (charge creation, webhook confirmation) uses the persisted `donations.amount`/`payments.grossAmount`.
- **`JSON.stringify` must never be called directly on a response body containing a bigint.** Use `packages/money`'s `bigIntSafeJSONStringify` if a route ever needs to hand-serialize (Elysia's own JSON serialization for typed responses already goes through TypeBox's `Type.String()` money-JSON convention established since Phase 1 — every money field in a contract schema is `MoneyJSONSchema` (`{ amount: Type.String(), currency: ... }`), built server-side via `moneyToJSON`, exactly like `apps/api/src/lib/campaign-response.ts` already does. Follow that exact pattern for every new money field in this plan — do not invent a second convention.
- **Donation idempotency, for real.** `POST /donations` requires a client-supplied `Idempotency-Key` header. The `idempotency_keys` table has a unique constraint on `key`; a duplicate key returns the *original* donation's response (200, not a new donation), never creates a second one. This is not optional hardening — it is Task 4's own acceptance test.
- **The webhook signature check is real cryptography, not a stub.** Compute `SHA512(orderId + statusCode + grossAmount + serverKey)` via Web Crypto's `crypto.subtle.digest("SHA-512", ...)`, hex-encode, and compare against the payload's `signature_key` field with a constant-time-safe comparison (timing-attack resistance matters less here than getting the actual Midtrans-documented algorithm right, but never compare with a raw `===` on hex strings derived from secret material — use a length-checked byte-by-byte comparison). A bad signature returns 401 and does **not** touch the database.
- **`payment_events` is the idempotency spine for webhooks.** `UNIQUE(provider, providerEventId)`. A duplicate webhook delivery hits the unique constraint on insert; catch that specific violation and return 200 with a no-op response — a duplicate webhook is not an error, it is the expected retry behavior every real payment provider relies on.
- **The paid-transition is one atomic transaction.** Inside `db.transaction(...)`: insert the `payment_events` row (the dedup guard — this must be the FIRST write, so a retry after a partial failure re-hits the unique-violation short-circuit rather than double-processing), update `donations.status` from `pending` to `paid` (guard the UPDATE's own WHERE clause on `status = 'pending'`, matching this project's now-established atomic-status-transition pattern from Phase 3's `campaigns.ts`/`admin.ts` and Phase 4's `help.ts` — 0 rows updated means this donation was already processed, which is a normal outcome given retries, not an error), increment `campaigns.collectedAmount` and `.donationCount` in the same transaction, and insert one `notifications_outbox` row (`status: "pending"`, no send attempted).
- **Eden Treaty kebab-case/route conventions, established since Phase 2a/2c/3/4:** any new route segment containing a hyphen needs bracket notation on the client (this plan doesn't introduce any hyphenated segments, but note it for whoever writes the frontend tasks' Eden calls regardless — `/donations`, `/payments` are plain, no bracket notation needed).
- **Eden Treaty response-type over-narrowing, established since Phase 3:** `donations.status` and `payments.status` are Postgres enums surfaced through `Type.Union([Type.Literal(...), ...])` contract fields. If `bun run typecheck` reports an over-narrowing error on either field in any `+page.server.ts` load, apply the established two-part cast fix (cast the base callable `as any`, then re-cast the awaited result to the real `Treaty.TreatyResponse<{...}>` type) — never leave the cast on just the callable.
- **A single shared error schema for this whole plan.** Define exactly ONE `PaymentErrorSchema = Type.Object({ error: Type.String() })` in `packages/contracts/src/payments.ts` and reuse it for every error response in this plan. Do not invent a second one, and do not reuse `CampaignErrorSchema` across package boundaries just because it has the same shape — this plan's own contracts file gets its own, exactly once (mirroring Phase 4's `HelpErrorSchema` precedent).
- **`bun run lint` clean before every commit.** **Repo-wide `bun run typecheck` (from the worktree root, never package-scoped only) for every task** — a documented Phase 2c incident showed a package-scoped typecheck missing a real cross-package Eden regression the repo-wide command catches immediately.
- **This repo is 100% Bun tooling. Never npm/yarn/npx.**
- **`bun` may not be on PATH in a fresh shell** — it's at `/home/ubuntu/.bun/bin/bun`. Either `export PATH="/home/ubuntu/.bun/bin:$PATH"` first or use the full path.
- **`apps/api` tests need `--env-file=../../.env`.** A freshly created worktree needs the repo root `.env` FILE COPIED IN MANUALLY (gitignored, doesn't carry over automatically) — this worktree already has it copied in and baseline verified, no task needs to redo this.
- **Three pre-existing, unrelated `apps/api` test failures may appear** (`sort=newest`, `sort=urgent`, `cover image URLs`) — these are a documented cross-test-isolation bug in `campaigns.test.ts` unrelated to any campaign/donation logic (see the project's own notes on this if curious). Do not attempt to fix them here; do not treat their presence as a regression from this plan's work.
- **No dependency on `apps/worker`, a real Midtrans adapter, or `notifications_outbox` actually sending anything.** All explicitly out of scope per above — don't design around any of them landing mid-plan.

## Domain Model / Interfaces Summary

New tables (`packages/db/src/schema/`, each added to the `schema/index.ts` barrel):
- `allocation_policies`: `id (uuid, pk)`, `name (text)`, `platformFeeBps (integer, not null, default 0)`, `isDefault (boolean, not null, default false)`, `createdAt`. Seeded with one row, `name: "default"`, `platformFeeBps: 0`, `isDefault: true`.
- `donations`: `id (uuid, pk)`, `userId (uuid, nullable, FK -> users.id, onDelete: set null — guest donation)`, `campaignId (uuid, not null, FK -> campaigns.id)`, `allocationPolicyId (uuid, not null, FK -> allocation_policies.id)`, `amount (bigint, not null)`, `currency (campaignCurrencyEnum, not null)`, `platformFee (bigint, not null, default 0)`, `isAnonymous (boolean, not null, default false)`, `comment (text, nullable)`, `status (donationStatusEnum: pending|paid|expired|failed|refunded, not null, default pending)`, `paidAt (timestamp, nullable)`, `createdAt`, `updatedAt`.
- `payments`: `id (uuid, pk)`, `donationId (uuid, not null, unique, FK -> donations.id)`, `provider (text, not null — "mock" for this plan)`, `method (text, not null — "bank_transfer_va" for this plan)`, `providerOrderId (text, not null, unique)`, `vaNumber (text, nullable)`, `expiresAt (timestamp, not null)`, `status (donationStatusEnum, not null, default pending)`, `rawPayload (jsonb, nullable)`, `createdAt`, `updatedAt`.
- `payment_events`: `id (uuid, pk)`, `provider (text, not null)`, `providerEventId (text, not null)`, `payload (jsonb, not null)`, `createdAt`. `UNIQUE(provider, providerEventId)`.
- `idempotency_keys`: `id (uuid, pk)`, `key (text, not null, unique)`, `endpoint (text, not null)`, `responseBody (jsonb, not null)`, `createdAt`.
- `notifications_outbox`: `id (uuid, pk)`, `channel (text, not null — "email" for this plan's one enqueue site)`, `template (text, not null — "donation_receipt")`, `payload (jsonb, not null)`, `status (text, not null, default "pending")`, `attempts (integer, not null, default 0)`, `createdAt`, `sentAt (timestamp, nullable)`.

New `packages/payments` package:
- `PaymentProvider` interface: `createCharge(input: ChargeInput): Promise<ChargeResult>`, `parseWebhook(req: Request): Promise<WebhookEvent>`, `getStatus(orderId: string): Promise<PaymentStatus>`, `createPayout(input: PayoutInput): Promise<PayoutResult>` (this last one throws `"not implemented"` in `MockPaymentProvider` — payouts are Phase 6).
- `MockPaymentProvider` — the only implementation this plan builds.

New API surface (`apps/api/src/routes/donations.ts`, new file):
- `POST /donations` — optional auth (guest donations allowed), idempotency-key required. Creates a `pending` donation + `payments` row via `provider.createCharge()`.
- `GET /donations/:id` — optional auth, ownership-scoped 404-not-403 for a logged-in donor's own donation OR accessible by a guest via the donation id itself (no ownership check needed for a guest donation — the id itself is the capability, matching how a VA number works in the real product).
- `POST /payments/webhook` — no auth (this is the provider calling us), signature-verified.

New web surface:
- `apps/web/src/routes/(consumer)/campaign/[slug]/donation-amount/+page.svelte` (+`+page.server.ts` if needed for campaign lookup).
- `apps/web/src/routes/(consumer)/campaign/[slug]/payment-option/+page.svelte`.
- `apps/web/src/routes/(consumer)/campaign/[slug]/contribute/+page.svelte` (+`+page.server.ts`, calls `POST /donations`, shows the VA number).
- `apps/web/src/routes/(consumer)/donation/status/[id]/+page.svelte` (+`+page.server.ts`, polls `GET /donations/:id`).

---

### Task 1: Schema — donations, payments, payment_events, idempotency_keys, allocation_policies, notifications_outbox

**Files:**
- Create: `packages/db/src/schema/allocation-policies.ts`
- Create: `packages/db/src/schema/donations.ts`
- Create: `packages/db/src/schema/payments.ts`
- Create: `packages/db/src/schema/payment-events.ts`
- Create: `packages/db/src/schema/idempotency-keys.ts`
- Create: `packages/db/src/schema/notifications-outbox.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/seed/allocation-policies.seed.ts`
- Modify: `packages/db/src/seed/run-seed.ts` (call the new seed function)
- Create: `packages/db/src/__tests__/donations.test.ts`
- Create: `packages/db/src/__tests__/payments.test.ts`

**Interfaces:**
- Consumes: `campaigns`, `users` (existing).
- Produces: `allocationPolicies`, `donations`, `payments`, `paymentEvents`, `idempotencyKeys`, `notificationsOutbox` tables, `donationStatusEnum` — consumed by Tasks 3, 4, 5, 6.

- [ ] **Step 1: Write the failing tests**

`packages/db/src/__tests__/donations.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { allocationPolicies } from "../schema/allocation-policies";
import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { donations } from "../schema/donations";
import { users } from "../schema/users";

const TEST_PHONE = "+6281199300001";

async function seedTestCampaign() {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found -- run db:seed first");
  const [campaigner] = await db
    .insert(campaigners)
    .values({ userId: (await ensureTestUser()).id, type: "individual", displayName: "Test Campaigner" })
    .onConflictDoNothing()
    .returning();
  const owner = campaigner ?? (await db.select().from(campaigners).limit(1))[0];
  if (!owner) throw new Error("no campaigner available");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `test-donation-campaign-${Date.now()}`,
      title: "Test Campaign",
      shortDescription: "Test",
      story: "Test",
      categoryId: category.id,
      campaignerId: owner.id,
      type: "donation",
      currency: "IDR",
      model: "goal",
      goalAmount: 10000000n,
      status: "active",
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  return campaign;
}

async function ensureTestUser() {
  await db.delete(users).where(eq(users.phone, TEST_PHONE));
  const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
  if (!user) throw new Error("user insert failed");
  return user;
}

describe("donations", () => {
  test("a guest donation can be created with a null userId", async () => {
    const campaign = await seedTestCampaign();
    const [policy] = await db.select().from(allocationPolicies).where(eq(allocationPolicies.isDefault, true));
    if (!policy) throw new Error("no default allocation policy seeded");
    const [donation] = await db
      .insert(donations)
      .values({
        campaignId: campaign.id,
        allocationPolicyId: policy.id,
        amount: 50000n,
        currency: "IDR",
      })
      .returning();
    expect(donation?.userId).toBeNull();
    expect(donation?.status).toBe("pending");
    expect(donation?.platformFee).toBe(0n);
  });

  test("a donation attached to a user records userId", async () => {
    const campaign = await seedTestCampaign();
    const user = await ensureTestUser();
    const [policy] = await db.select().from(allocationPolicies).where(eq(allocationPolicies.isDefault, true));
    if (!policy) throw new Error("no default allocation policy seeded");
    const [donation] = await db
      .insert(donations)
      .values({
        userId: user.id,
        campaignId: campaign.id,
        allocationPolicyId: policy.id,
        amount: 100000n,
        currency: "IDR",
      })
      .returning();
    expect(donation?.userId).toBe(user.id);
  });
});
```

`packages/db/src/__tests__/payments.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { paymentEvents } from "../schema/payment-events";

describe("payment_events", () => {
  test("provider + providerEventId is unique -- a duplicate insert rejects", async () => {
    await db.delete(paymentEvents).where(eq(paymentEvents.providerEventId, "test-event-dedup-1"));
    await db.insert(paymentEvents).values({
      provider: "mock",
      providerEventId: "test-event-dedup-1",
      payload: { test: true },
    });
    await expect(
      db.insert(paymentEvents).values({
        provider: "mock",
        providerEventId: "test-event-dedup-1",
        payload: { test: true, second: true },
      }),
    ).rejects.toThrow(/unique/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/db && bun test src/__tests__/donations.test.ts src/__tests__/payments.test.ts`
Expected: FAIL — none of the referenced modules/tables exist yet.

- [ ] **Step 3: Implement the schema files**

`packages/db/src/schema/allocation-policies.ts`:

```ts
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const allocationPolicies = pgTable("allocation_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Basis points (1/100 of a percent). 0 = no platform fee. This is a
  // placeholder default, not a business decision -- see this plan's
  // "Explicitly Out of Scope" note.
  platformFeeBps: integer("platform_fee_bps").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AllocationPolicy = typeof allocationPolicies.$inferSelect;
export type NewAllocationPolicy = typeof allocationPolicies.$inferInsert;
```

`packages/db/src/schema/donations.ts`:

```ts
import { sql } from "drizzle-orm";
import { bigint, boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { allocationPolicies } from "./allocation-policies";
import { campaignCurrencyEnum, campaigns } from "./campaigns";
import { users } from "./users";

export const donationStatusEnum = pgEnum("donation_status", [
  "pending",
  "paid",
  "expired",
  "failed",
  "refunded",
]);

export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  allocationPolicyId: uuid("allocation_policy_id")
    .notNull()
    .references(() => allocationPolicies.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  currency: campaignCurrencyEnum("currency").notNull(),
  platformFee: bigint("platform_fee", { mode: "bigint" }).notNull().default(sql`0`),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  comment: text("comment"),
  status: donationStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Donation = typeof donations.$inferSelect;
export type NewDonation = typeof donations.$inferInsert;
```

`packages/db/src/schema/payments.ts`:

```ts
import { bigint, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { donationStatusEnum, donations } from "./donations";

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  donationId: uuid("donation_id")
    .notNull()
    .unique()
    .references(() => donations.id),
  provider: text("provider").notNull(),
  method: text("method").notNull(),
  providerOrderId: text("provider_order_id").notNull().unique(),
  vaNumber: text("va_number"),
  grossAmount: bigint("gross_amount", { mode: "bigint" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: donationStatusEnum("status").notNull().default("pending"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
```

`packages/db/src/schema/payment-events.ts`:

```ts
import { jsonb, pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.provider, table.providerEventId)],
);

export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type NewPaymentEvent = typeof paymentEvents.$inferInsert;
```

`packages/db/src/schema/idempotency-keys.ts`:

```ts
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const idempotencyKeys = pgTable("idempotency_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  endpoint: text("endpoint").notNull(),
  responseBody: jsonb("response_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyRow = typeof idempotencyKeys.$inferInsert;
```

`packages/db/src/schema/notifications-outbox.ts`:

```ts
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notificationsOutbox = pgTable("notifications_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  template: text("template").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export type NotificationOutboxRow = typeof notificationsOutbox.$inferSelect;
export type NewNotificationOutboxRow = typeof notificationsOutbox.$inferInsert;
```

- [ ] **Step 4: Export from `packages/db/src/schema/index.ts`**

Add export lines for all six new files, matching the existing barrel style exactly (one `export * from "./<file>";` line per file, alphabetically placed among the existing ones).

- [ ] **Step 5: Seed the default allocation policy**

`packages/db/src/seed/allocation-policies.seed.ts`:

```ts
import { db } from "../client";
import { allocationPolicies } from "../schema/allocation-policies";

export async function seedAllocationPolicies(): Promise<void> {
  const existing = await db.select().from(allocationPolicies).limit(1);
  if (existing.length > 0) {
    console.log("Allocation policies already seeded, skipping.");
    return;
  }
  await db.insert(allocationPolicies).values({ name: "default", platformFeeBps: 0, isDefault: true });
  console.log("Seeded 1 default allocation policy (0% platform fee).");
}
```

Add a call to `seedAllocationPolicies()` in `packages/db/src/seed/run-seed.ts`, in the same sequential-await style as the existing seed calls, placed after categories/campaigners (before campaigns, since nothing in this plan makes campaign seeding depend on it, but it's a natural place alongside the other reference-data seeds).

- [ ] **Step 6: Generate and run the migration**

Run: `cd packages/db && bun run generate` (or this repo's equivalent drizzle-kit generate script — check `packages/db/package.json` for the exact script name), then `bun run db:migrate` from the worktree root.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd packages/db && bun test src/__tests__/donations.test.ts src/__tests__/payments.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): add donations, payments, and checkout-support schema"
```

---

### Task 2: Contracts — `packages/contracts/src/payments.ts`

**Files:**
- Create: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `MoneyJSONSchema` (existing, from `./campaigns`, reused — do not redefine it).
- Produces: `PaymentErrorSchema`, `CreateDonationBodySchema`, `CreateDonationResponseSchema`, `DonationStatusSchema`, `GetDonationResponseSchema` — consumed by Tasks 4, 5, 6, and every frontend task.

No failing-test step — schema definitions have no runtime behavior; correctness is proven by the API tasks that use them and by `bun run typecheck`.

- [ ] **Step 1: Create `packages/contracts/src/payments.ts`**

```ts
import { type Static, Type } from "@sinclair/typebox";
import { MoneyJSONSchema } from "./campaigns";

export const PaymentErrorSchema = Type.Object({ error: Type.String() });

export const CreateDonationBodySchema = Type.Object({
  campaignId: Type.String({ format: "uuid" }),
  // Minor-unit rupiah as a decimal string, never a JSON number -- same
  // convention as SaveCampaignGoalAmountBodySchema.
  amountStr: Type.String({ pattern: "^\\d+$", maxLength: 15 }),
  isAnonymous: Type.Optional(Type.Boolean()),
  comment: Type.Optional(Type.String({ maxLength: 500 })),
});

export const CreateDonationResponseSchema = Type.Object({
  donationId: Type.String({ format: "uuid" }),
  vaNumber: Type.String(),
  amount: MoneyJSONSchema,
  expiresAt: Type.String({ format: "date-time" }),
});
export type CreateDonationResponse = Static<typeof CreateDonationResponseSchema>;

export const DonationStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("paid"),
  Type.Literal("expired"),
  Type.Literal("failed"),
  Type.Literal("refunded"),
]);

export const GetDonationResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  campaignId: Type.String({ format: "uuid" }),
  amount: MoneyJSONSchema,
  status: DonationStatusSchema,
  vaNumber: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.String({ format: "date-time" }),
  paidAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});
export type GetDonationResponse = Static<typeof GetDonationResponseSchema>;
```

- [ ] **Step 2: Export from `packages/contracts/src/index.ts`**

```ts
export {
  CreateDonationBodySchema,
  CreateDonationResponseSchema,
  DonationStatusSchema,
  GetDonationResponseSchema,
  PaymentErrorSchema,
} from "./payments";
export type { CreateDonationResponse, GetDonationResponse } from "./payments";
```

- [ ] **Step 3: Run lint and typecheck**

Run: `cd <worktree root> && bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add donation/payment schemas"
```

---

### Task 3: `packages/payments` — `PaymentProvider` interface + `MockPaymentProvider`

**Files:**
- Create: `packages/payments/package.json`
- Create: `packages/payments/tsconfig.json`
- Create: `packages/payments/src/index.ts`
- Create: `packages/payments/src/types.ts`
- Create: `packages/payments/src/mock-provider.ts`
- Create: `packages/payments/src/signature.ts`
- Create: `packages/payments/src/mock-provider.test.ts`
- Create: `packages/payments/src/signature.test.ts`

**Interfaces:**
- Consumes: nothing from this monorepo (this package has zero internal dependencies — it's the boundary layer).
- Produces: `PaymentProvider`, `ChargeInput`, `ChargeResult`, `WebhookEvent`, `PaymentStatus`, `PayoutInput`, `PayoutResult` types, `MockPaymentProvider` class, `computeMidtransSignature`/`verifyMidtransSignature` functions — consumed by Tasks 4 and 5.

Check an existing simple package (`packages/money/package.json`, `packages/money/tsconfig.json`) for this monorepo's exact package-scaffolding convention (workspace `name`, `exports` field, `tsconfig` `extends` path) and match it exactly rather than guessing at the shape.

- [ ] **Step 1: Write the failing tests**

`packages/payments/src/signature.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { computeMidtransSignature, verifyMidtransSignature } from "./signature";

const SERVER_KEY = "test-server-key-do-not-use-in-prod";

describe("Midtrans-style signature", () => {
  test("computes a deterministic SHA512 hex digest", async () => {
    const sig1 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "50000.00" },
      SERVER_KEY,
    );
    const sig2 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "50000.00" },
      SERVER_KEY,
    );
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{128}$/); // SHA512 hex = 128 chars
  });

  test("a different gross amount produces a different signature", async () => {
    const sig1 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "50000.00" },
      SERVER_KEY,
    );
    const sig2 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "99999.00" },
      SERVER_KEY,
    );
    expect(sig1).not.toBe(sig2);
  });

  test("verifyMidtransSignature accepts a signature computed with the same inputs", async () => {
    const input = { orderId: "order-2", statusCode: "200", grossAmount: "10000.00" };
    const sig = await computeMidtransSignature(input, SERVER_KEY);
    expect(await verifyMidtransSignature(input, sig, SERVER_KEY)).toBe(true);
  });

  test("verifyMidtransSignature rejects a tampered signature", async () => {
    const input = { orderId: "order-3", statusCode: "200", grossAmount: "10000.00" };
    const sig = await computeMidtransSignature(input, SERVER_KEY);
    const tampered = `${sig.slice(0, -1)}${sig.at(-1) === "0" ? "1" : "0"}`;
    expect(await verifyMidtransSignature(input, tampered, SERVER_KEY)).toBe(false);
  });

  test("verifyMidtransSignature rejects a signature computed with the wrong server key", async () => {
    const input = { orderId: "order-4", statusCode: "200", grossAmount: "10000.00" };
    const sig = await computeMidtransSignature(input, "a-completely-different-key");
    expect(await verifyMidtransSignature(input, sig, SERVER_KEY)).toBe(false);
  });
});
```

`packages/payments/src/mock-provider.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MockPaymentProvider } from "./mock-provider";

describe("MockPaymentProvider", () => {
  test("createCharge returns a VA number and a real provider order id", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    const result = await provider.createCharge({
      orderId: "donation-order-1",
      grossAmount: 50000n,
      currency: "IDR",
    });
    expect(result.vaNumber).toMatch(/^\d{10,16}$/);
    expect(result.providerOrderId).toBe("donation-order-1");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("simulateWebhookPayload produces a payload that verifies against the same provider's server key", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    const charge = await provider.createCharge({
      orderId: "donation-order-2",
      grossAmount: 75000n,
      currency: "IDR",
    });
    const payload = await provider.simulateWebhookPayload(charge.providerOrderId, 75000n);
    const req = new Request("http://localhost/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const event = await provider.parseWebhook(req);
    expect(event.providerOrderId).toBe("donation-order-2");
    expect(event.status).toBe("paid");
  });

  test("parseWebhook throws on a bad signature", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    const charge = await provider.createCharge({
      orderId: "donation-order-3",
      grossAmount: 10000n,
      currency: "IDR",
    });
    const payload = await provider.simulateWebhookPayload(charge.providerOrderId, 10000n);
    const tamperedPayload = { ...payload, signature_key: "0".repeat(128) };
    const req = new Request("http://localhost/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tamperedPayload),
    });
    await expect(provider.parseWebhook(req)).rejects.toThrow(/signature/i);
  });

  test("createPayout is not implemented (payouts are Phase 6)", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    await expect(
      provider.createPayout({ orderId: "x", amount: 1n, bankAccount: "x", bankCode: "x" }),
    ).rejects.toThrow(/not implemented/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/payments && bun test`
Expected: FAIL — none of the source files exist yet (create `package.json`/`tsconfig.json` first, matching `packages/money`'s exact shape, so `bun test` even resolves the package).

- [ ] **Step 3: Implement `packages/payments/src/signature.ts`**

```ts
/**
 * The exact signature scheme Midtrans documents for webhook notifications:
 * SHA512(order_id + status_code + gross_amount + server_key), hex-encoded.
 * Built against the real documented algorithm now, even though only
 * MockPaymentProvider calls it in this plan, so a real Midtrans adapter
 * later reuses this file unchanged.
 */
export interface SignatureInput {
  orderId: string;
  statusCode: string;
  grossAmount: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeMidtransSignature(
  input: SignatureInput,
  serverKey: string,
): Promise<string> {
  const message = `${input.orderId}${input.statusCode}${input.grossAmount}${serverKey}`;
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(message));
  return toHex(digest);
}

/**
 * Length-checked, byte-by-byte comparison rather than `===` on the hex
 * strings -- signature comparison should not short-circuit on the first
 * differing character in a way that leaks timing information about how
 * much of the expected signature was matched.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyMidtransSignature(
  input: SignatureInput,
  providedSignature: string,
  serverKey: string,
): Promise<boolean> {
  const expected = await computeMidtransSignature(input, serverKey);
  return constantTimeEqual(expected, providedSignature);
}
```

- [ ] **Step 4: Implement `packages/payments/src/types.ts`**

```ts
export type PaymentMethod = "bank_transfer_va";

export interface ChargeInput {
  orderId: string;
  grossAmount: bigint;
  currency: "IDR" | "USD";
}

export interface ChargeResult {
  providerOrderId: string;
  method: PaymentMethod;
  vaNumber: string;
  expiresAt: Date;
}

export interface WebhookEvent {
  providerEventId: string;
  providerOrderId: string;
  status: "paid" | "failed" | "expired";
  rawPayload: unknown;
}

export interface PaymentStatus {
  providerOrderId: string;
  status: "pending" | "paid" | "failed" | "expired";
}

export interface PayoutInput {
  orderId: string;
  amount: bigint;
  bankAccount: string;
  bankCode: string;
}

export interface PayoutResult {
  payoutId: string;
}

export interface PaymentProvider {
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  parseWebhook(req: Request): Promise<WebhookEvent>;
  getStatus(orderId: string): Promise<PaymentStatus>;
  createPayout(input: PayoutInput): Promise<PayoutResult>;
}
```

- [ ] **Step 5: Implement `packages/payments/src/mock-provider.ts`**

```ts
import { computeMidtransSignature, verifyMidtransSignature } from "./signature";
import type {
  ChargeInput,
  ChargeResult,
  PayoutInput,
  PayoutResult,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from "./types";

const VA_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Behaves like a real bank-transfer-VA provider (generates a VA number,
 * accepts webhook payloads shaped and signed exactly like Midtrans's real
 * ones -- see signature.ts) without any real network call or third-party
 * dependency. See this plan's "Explicitly Out of Scope" section for why a
 * real MidtransProvider isn't built yet.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly serverKey: string;
  // In-memory charge registry keyed by providerOrderId -- fine for this
  // mock (no real persistence needed; apps/api persists the real payments
  // row itself), but means a MockPaymentProvider instance's charges don't
  // survive a process restart. Every consumer in this plan constructs one
  // instance per request/test, which is why this is safe.
  private readonly charges = new Map<string, ChargeResult>();

  constructor(config: { serverKey: string }) {
    this.serverKey = config.serverKey;
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    // A deterministic-looking VA number derived from the order id, not
    // cryptographically meaningful -- this is a mock, the only property
    // that matters is "looks like a real VA number and is stable per
    // order". Real bank VA numbers are typically 10-16 digits.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.orderId));
    const vaNumber = Array.from(new Uint8Array(digest).slice(0, 7))
      .map((b) => b.toString().padStart(3, "0"))
      .join("")
      .slice(0, 14);
    const result: ChargeResult = {
      providerOrderId: input.orderId,
      method: "bank_transfer_va",
      vaNumber,
      expiresAt: new Date(Date.now() + VA_EXPIRY_MS),
    };
    this.charges.set(input.orderId, result);
    return result;
  }

  /**
   * Test/dev-only helper -- not part of the PaymentProvider interface.
   * Produces a webhook payload shaped and signed exactly like a real
   * Midtrans notification, for a charge this same instance created.
   */
  async simulateWebhookPayload(orderId: string, grossAmount: bigint): Promise<Record<string, unknown>> {
    const statusCode = "200";
    const grossAmountStr = `${grossAmount.toString()}.00`;
    const signature = await computeMidtransSignature(
      { orderId, statusCode, grossAmount: grossAmountStr },
      this.serverKey,
    );
    return {
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmountStr,
      transaction_status: "settlement",
      transaction_id: `evt-${orderId}-${Date.now()}`,
      signature_key: signature,
    };
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const body = (await req.json()) as Record<string, unknown>;
    const orderId = String(body.order_id ?? "");
    const statusCode = String(body.status_code ?? "");
    const grossAmount = String(body.gross_amount ?? "");
    const providedSignature = String(body.signature_key ?? "");

    const valid = await verifyMidtransSignature(
      { orderId, statusCode, grossAmount },
      providedSignature,
      this.serverKey,
    );
    if (!valid) {
      throw new Error("invalid webhook signature");
    }

    const transactionStatus = String(body.transaction_status ?? "");
    const status: WebhookEvent["status"] =
      transactionStatus === "settlement" || transactionStatus === "capture"
        ? "paid"
        : transactionStatus === "expire"
          ? "expired"
          : "failed";

    return {
      providerEventId: String(body.transaction_id ?? ""),
      providerOrderId: orderId,
      status,
      rawPayload: body,
    };
  }

  async getStatus(orderId: string): Promise<PaymentStatus> {
    // No real reconciler consumes this in this plan (see "Explicitly Out
    // of Scope") -- implemented for interface completeness and so a real
    // adapter's getStatus has a mock counterpart to test the reconciler
    // against later.
    const charge = this.charges.get(orderId);
    return { providerOrderId: orderId, status: charge ? "pending" : "failed" };
  }

  async createPayout(_input: PayoutInput): Promise<PayoutResult> {
    throw new Error("createPayout is not implemented -- payouts are Phase 6 scope");
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/payments && bun test`
Expected: PASS.

- [ ] **Step 7: Export from `packages/payments/src/index.ts`**

```ts
export { computeMidtransSignature, verifyMidtransSignature } from "./signature";
export { MockPaymentProvider } from "./mock-provider";
export type {
  ChargeInput,
  ChargeResult,
  PayoutInput,
  PayoutResult,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  WebhookEvent,
} from "./types";
```

- [ ] **Step 8: Run repo-wide lint and typecheck**

Run: `cd <worktree root> && bun run lint && bun run typecheck`
Expected: clean. (If `packages/payments` isn't picked up by the root `typecheck`/`lint` turbo pipeline, check `turbo.json`/the root `package.json`'s workspaces glob — it should be automatic since it's a new `packages/*` directory with a `package.json`, matching every existing package, but verify rather than assume.)

- [ ] **Step 9: Commit**

```bash
git add packages/payments
git commit -m "feat(payments): add PaymentProvider interface and MockPaymentProvider"
```

---

### Task 4: API — `POST /donations` (idempotent charge creation)

**Files:**
- Create: `apps/api/src/routes/donations.ts`
- Create: `apps/api/src/routes/donations.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `donations`, `payments`, `allocationPolicies`, `idempotencyKeys` (Task 1); `CreateDonationBodySchema`, `CreateDonationResponseSchema`, `PaymentErrorSchema` (Task 2); `MockPaymentProvider` (Task 3); `sessionDerive` (existing).
- Produces: the `donationsRoute` Elysia plugin (`POST /donations` in this task, `GET /donations/:id` in Task 6) — consumed by Task 5 (webhook needs the same `donations`/`payments` rows) and every frontend task.

A `MOCK_MIDTRANS_SERVER_KEY` env var backs the `MockPaymentProvider` instance this route constructs — default to a fixed test string (e.g. `"mock-server-key-for-dev"`) via `process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev"` so tests and local dev never need a real secret, matching the `IMGPROXY_KEY`/`MEILISEARCH_API_KEY` fallback-default convention already established in this codebase's CI workflow and `apps/api` code.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { db, campaignCategories, campaigners, campaigns, donations, payments, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { donationsRoute } from "./donations";

const app = donationsRoute;

async function seedTestCampaign() {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category -- run db:seed first");
  const [existingCampaigner] = await db.select().from(campaigners).limit(1);
  if (!existingCampaigner) throw new Error("no seeded campaigner -- run db:seed first");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `test-checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Test Checkout Campaign",
      shortDescription: "Test",
      story: "Test",
      categoryId: category.id,
      campaignerId: existingCampaigner.id,
      type: "donation",
      currency: "IDR",
      model: "goal",
      goalAmount: 10000000n,
      status: "active",
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  return campaign;
}

describe("POST /donations", () => {
  test("creates a pending donation and a payment with a VA number, for a guest", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "50000" }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { donationId: string; vaNumber: string };
    expect(body.vaNumber).toMatch(/^\d+$/);
    const [donation] = await db.select().from(donations).where(eq(donations.id, body.donationId));
    expect(donation?.status).toBe("pending");
    expect(donation?.userId).toBeNull();
    expect(donation?.amount).toBe(50000n);
    const [payment] = await db.select().from(payments).where(eq(payments.donationId, body.donationId));
    expect(payment?.vaNumber).toBe(body.vaNumber);
  });

  test("400s without an Idempotency-Key header", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "50000" }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("a repeated Idempotency-Key returns the same donation, not a new one", async () => {
    const campaign = await seedTestCampaign();
    const key = crypto.randomUUID();
    const req = () =>
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "75000" }),
      });
    const first = await app.handle(req());
    const firstBody = (await first.json()) as { donationId: string };
    const second = await app.handle(req());
    const secondBody = (await second.json()) as { donationId: string };
    expect(secondBody.donationId).toBe(firstBody.donationId);
    const rows = await db.select().from(donations).where(eq(donations.id, firstBody.donationId));
    expect(rows).toHaveLength(1);
  });

  test("404s for a nonexistent campaign", async () => {
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          campaignId: "00000000-0000-0000-0000-000000000000",
          amountStr: "50000",
        }),
      }),
    );
    expect(resp.status).toBe(404);
  });

  test("422s on a non-numeric amountStr", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "not-a-number" }),
      }),
    );
    expect(resp.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/donations.test.ts --env-file=../../.env`
Expected: FAIL — `./donations` doesn't exist yet.

- [ ] **Step 3: Implement `apps/api/src/routes/donations.ts`**

```ts
import {
  CreateDonationBodySchema,
  CreateDonationResponseSchema,
  PaymentErrorSchema,
} from "@galangdana/contracts";
import {
  allocationPolicies,
  campaigns,
  db,
  donations,
  idempotencyKeys,
  payments,
} from "@galangdana/db";
import { moneyToJSON } from "@galangdana/money";
import { MockPaymentProvider } from "@galangdana/payments";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

const SERVER_KEY = process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev";

function getProvider() {
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}

export const donationsRoute = new Elysia()
  .use(sessionDerive)
  .post(
    "/donations",
    async ({ user, body, headers, set }) => {
      const idempotencyKey = headers["idempotency-key"];
      if (!idempotencyKey) {
        set.status = 400;
        return { error: "missing_idempotency_key" };
      }

      const [existingKey] = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey));
      if (existingKey) {
        return existingKey.responseBody as ReturnType<typeof buildResponseBody> extends Promise<
          infer T
        >
          ? T
          : never;
      }

      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, body.campaignId));
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const [policy] = await db
        .select()
        .from(allocationPolicies)
        .where(eq(allocationPolicies.isDefault, true));
      if (!policy) {
        throw new Error("no default allocation policy configured");
      }

      const amount = BigInt(body.amountStr);
      const platformFee = (amount * BigInt(policy.platformFeeBps)) / 10000n;

      const [donation] = await db
        .insert(donations)
        .values({
          userId: user?.id,
          campaignId: campaign.id,
          allocationPolicyId: policy.id,
          amount,
          currency: campaign.currency,
          platformFee,
          isAnonymous: body.isAnonymous ?? false,
          comment: body.comment,
        })
        .returning();
      if (!donation) throw new Error("donation insert returned no row");

      const provider = getProvider();
      const charge = await provider.createCharge({
        orderId: donation.id,
        grossAmount: amount,
        currency: campaign.currency,
      });

      await db.insert(payments).values({
        donationId: donation.id,
        provider: "mock",
        method: charge.method,
        providerOrderId: charge.providerOrderId,
        vaNumber: charge.vaNumber,
        grossAmount: amount,
        expiresAt: charge.expiresAt,
      });

      const responseBody = {
        donationId: donation.id,
        vaNumber: charge.vaNumber,
        amount: moneyToJSON({ amount, currency: campaign.currency }),
        expiresAt: charge.expiresAt.toISOString(),
      };

      await db.insert(idempotencyKeys).values({
        key: idempotencyKey,
        endpoint: "POST /donations",
        responseBody,
      });

      return responseBody;
    },
    {
      headers: t.Object({ "idempotency-key": t.Optional(t.String()) }),
      body: CreateDonationBodySchema,
      response: {
        200: CreateDonationResponseSchema,
        400: PaymentErrorSchema,
        404: PaymentErrorSchema,
      },
    },
  );

// Referenced only for the idempotency-replay type cast above -- not
// exported, exists so that cast has a concrete type to point at rather
// than an inline duplicate of the response shape.
async function buildResponseBody() {
  return {} as { donationId: string; vaNumber: string; amount: unknown; expiresAt: string };
}
```

(The `buildResponseBody`/cast dance around the idempotency-replay branch is awkward -- if `bun run typecheck` flags it, simplify by typing `existingKey.responseBody` directly as `Static<typeof CreateDonationResponseSchema>` imported from contracts instead of the local helper function. Prefer that simpler form; the helper above is a fallback sketch, not a mandate. Note in your report which form you used.)

- [ ] **Step 4: Mount the route — `apps/api/src/index.ts`**

Add `import { donationsRoute } from "./routes/donations";` and `.use(donationsRoute)` after `.use(helpRoute)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/donations.test.ts --env-file=../../.env`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: clean except the 3 documented pre-existing failures (Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add idempotent POST /donations against the mock payment provider"
```

---

### Task 5: API — `POST /payments/webhook` (signature verification, dedup, atomic paid-transition)

**Files:**
- Modify: `apps/api/src/routes/donations.ts`
- Modify: `apps/api/src/routes/donations.test.ts`

**Interfaces:**
- Consumes: `payments`, `donations`, `paymentEvents`, `campaigns`, `notificationsOutbox` (Task 1); `MockPaymentProvider` (Task 3, same instance-construction pattern as Task 4).
- Produces: the atomic paid-transition — consumed by nothing further in this plan (it's the terminal step of the flow), but Task 6's `GET /donations/:id` reads the `status` this handler sets.

This is the highest-risk task in the plan. Read this plan's Global Constraints section on the atomic-transition pattern again before starting.

- [ ] **Step 1: Write the failing tests — append to `donations.test.ts`**

```ts
import { paymentEvents } from "@galangdana/db"; // add to the existing top-of-file import from "@galangdana/db"

describe("POST /payments/webhook", () => {
  async function createTestDonation(amountStr: string) {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr }),
      }),
    );
    const body = (await resp.json()) as { donationId: string; vaNumber: string };
    const [payment] = await db.select().from(payments).where(eq(payments.donationId, body.donationId));
    if (!payment) throw new Error("payment row missing");
    return { campaign, donationId: body.donationId, providerOrderId: payment.providerOrderId };
  }

  test("a valid webhook marks the donation paid and increments campaign totals", async () => {
    const { campaign, donationId, providerOrderId } = await createTestDonation("50000");
    const provider = new MockPaymentProvider({ serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev" });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 50000n);

    const [campaignBefore] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));

    const resp = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(resp.status).toBe(200);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("paid");
    expect(donation?.paidAt).not.toBeNull();

    const [campaignAfter] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignAfter?.collectedAmount).toBe((campaignBefore?.collectedAmount ?? 0n) + 50000n);
    expect(campaignAfter?.donationCount).toBe((campaignBefore?.donationCount ?? 0) + 1);
  });

  test("a duplicate webhook delivery is a 200 no-op, not a double-processed donation", async () => {
    const { campaign, donationId, providerOrderId } = await createTestDonation("30000");
    const provider = new MockPaymentProvider({ serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev" });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 30000n);

    const first = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(first.status).toBe(200);
    const [campaignAfterFirst] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));

    // Same exact payload delivered again (a real provider's documented retry behavior).
    const second = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(second.status).toBe(200);

    const [campaignAfterSecond] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignAfterSecond?.collectedAmount).toBe(campaignAfterFirst?.collectedAmount);
    expect(campaignAfterSecond?.donationCount).toBe(campaignAfterFirst?.donationCount);
    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("paid"); // still paid, not re-processed into some other state
  });

  test("a bad signature is rejected with 401 and never touches the donation", async () => {
    const { donationId, providerOrderId } = await createTestDonation("40000");
    const provider = new MockPaymentProvider({ serverKey: "wrong-key-entirely" });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 40000n);

    const resp = await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(resp.status).toBe(401);

    const [donation] = await db.select().from(donations).where(eq(donations.id, donationId));
    expect(donation?.status).toBe("pending");
  });

  test("enqueues one notifications_outbox row on a successful paid transition", async () => {
    const { donationId, providerOrderId } = await createTestDonation("60000");
    const provider = new MockPaymentProvider({ serverKey: process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev" });
    const payload = await provider.simulateWebhookPayload(providerOrderId, 60000n);
    await app.handle(
      new Request("http://localhost/payments/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    const outboxRows = await db
      .select()
      .from(notificationsOutbox)
      .where(eq(notificationsOutbox.template, "donation_receipt"));
    expect(outboxRows.some((r) => (r.payload as { donationId?: string }).donationId === donationId)).toBe(
      true,
    );
  });
});
```

(Add `notificationsOutbox` to the existing `@galangdana/db` import list at the top of the file alongside `paymentEvents`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/donations.test.ts --env-file=../../.env`
Expected: FAIL — the webhook route doesn't exist yet.

- [ ] **Step 3: Implement — extend `apps/api/src/routes/donations.ts`**

Add these imports (merge with the existing ones):

```ts
import { campaigns, notificationsOutbox, paymentEvents } from "@galangdana/db";
import { and, eq, sql } from "drizzle-orm";
```

Append this handler to the existing `donationsRoute` chain:

```ts
  .post(
    "/payments/webhook",
    async ({ request, set }) => {
      const provider = getProvider();
      let event: Awaited<ReturnType<typeof provider.parseWebhook>>;
      try {
        event = await provider.parseWebhook(request);
      } catch {
        set.status = 401;
        return { error: "invalid_signature" };
      }

      const result = await db.transaction(async (tx) => {
        // First write: the dedup guard. A retried/duplicate delivery hits
        // this table's UNIQUE(provider, providerEventId) constraint and
        // throws before any other write happens.
        try {
          await tx.insert(paymentEvents).values({
            provider: "mock",
            providerEventId: event.providerEventId,
            payload: event.rawPayload as object,
          });
        } catch (err) {
          if ((err as { code?: string }).code === "23505") {
            return { alreadyProcessed: true as const };
          }
          throw err;
        }

        if (event.status !== "paid") {
          await tx
            .update(payments)
            .set({ status: event.status, updatedAt: new Date() })
            .where(eq(payments.providerOrderId, event.providerOrderId));
          return { alreadyProcessed: false as const, paid: false as const };
        }

        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.providerOrderId, event.providerOrderId));
        if (!payment) {
          throw new Error(`webhook for unknown providerOrderId: ${event.providerOrderId}`);
        }

        const now = new Date();
        const updatedDonations = await tx
          .update(donations)
          .set({ status: "paid", paidAt: now, updatedAt: now })
          .where(and(eq(donations.id, payment.donationId), eq(donations.status, "pending")))
          .returning();
        if (updatedDonations.length === 0) {
          // Already paid by a prior delivery that beat the payment_events
          // dedup guard in a genuine race (two concurrent deliveries both
          // inserting different providerEventIds for the same order) --
          // treat as already-processed, not an error.
          return { alreadyProcessed: true as const };
        }
        const donation = updatedDonations[0];
        if (!donation) throw new Error("unreachable: update returned no row after length check");

        await tx
          .update(payments)
          .set({ status: "paid", updatedAt: now })
          .where(eq(payments.id, payment.id));

        await tx
          .update(campaigns)
          .set({
            collectedAmount: sql`${campaigns.collectedAmount} + ${donation.amount}`,
            donationCount: sql`${campaigns.donationCount} + 1`,
          })
          .where(eq(campaigns.id, donation.campaignId));

        await tx.insert(notificationsOutbox).values({
          channel: "email",
          template: "donation_receipt",
          payload: { donationId: donation.id, campaignId: donation.campaignId },
        });

        return { alreadyProcessed: false as const, paid: true as const };
      });

      return { status: result.alreadyProcessed ? "already_processed" : "processed" };
    },
    {
      response: {
        200: t.Object({ status: t.String() }),
        401: PaymentErrorSchema,
      },
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/donations.test.ts --env-file=../../.env`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: clean except the 3 documented pre-existing failures.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add signature-verified, idempotent payment webhook with atomic paid transition"
```

---

### Task 6: API — `GET /donations/:id` (status polling)

**Files:**
- Modify: `apps/api/src/routes/donations.ts`
- Modify: `apps/api/src/routes/donations.test.ts`

**Interfaces:**
- Consumes: `donations`, `payments` (Task 1); `GetDonationResponseSchema`, `PaymentErrorSchema` (Task 2).
- Produces: the donation status endpoint — consumed by the status-page frontend task (Task 10).

A donation's `id` (a UUID, effectively unguessable) is itself the access capability for a guest donation, matching how a real VA number/receipt link works in the actual product -- no ownership check is needed for a guest donation (`userId IS NULL`). When a donation DOES have a `userId`, only that user (or no one, since there's no admin donation-lookup route in this plan) may view it -- return the identical 404 for "doesn't exist" and "belongs to someone else", matching this project's established ownership-scoped 404-not-403 convention.

- [ ] **Step 1: Write the failing tests — append to `donations.test.ts`**

```ts
describe("GET /donations/:id", () => {
  test("returns a guest donation's status by id, no auth required", async () => {
    const campaign = await seedTestCampaign();
    const resp = await app.handle(
      new Request("http://localhost/donations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ campaignId: campaign.id, amountStr: "20000" }),
      }),
    );
    const { donationId } = (await resp.json()) as { donationId: string };

    const statusResp = await app.handle(new Request(`http://localhost/donations/${donationId}`));
    expect(statusResp.status).toBe(200);
    const body = (await statusResp.json()) as { id: string; status: string; vaNumber: string | null };
    expect(body.id).toBe(donationId);
    expect(body.status).toBe("pending");
    expect(body.vaNumber).not.toBeNull();
  });

  test("404s for a nonexistent donation id", async () => {
    const resp = await app.handle(
      new Request("http://localhost/donations/00000000-0000-0000-0000-000000000000"),
    );
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/donations.test.ts --env-file=../../.env`
Expected: FAIL.

- [ ] **Step 3: Implement — extend `apps/api/src/routes/donations.ts`**

```ts
  .get(
    "/donations/:id",
    async ({ user, params, set }) => {
      const [row] = await db
        .select({ donation: donations, payment: payments })
        .from(donations)
        .innerJoin(payments, eq(payments.donationId, donations.id))
        .where(eq(donations.id, params.id));
      if (!row) {
        set.status = 404;
        return { error: "donation_not_found" };
      }
      if (row.donation.userId && row.donation.userId !== user?.id) {
        set.status = 404;
        return { error: "donation_not_found" };
      }
      return {
        id: row.donation.id,
        campaignId: row.donation.campaignId,
        amount: moneyToJSON({ amount: row.donation.amount, currency: row.donation.currency }),
        status: row.donation.status,
        vaNumber: row.payment.vaNumber,
        expiresAt: row.payment.expiresAt.toISOString(),
        paidAt: row.donation.paidAt?.toISOString() ?? null,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: GetDonationResponseSchema, 404: PaymentErrorSchema },
    },
  );
```

(Add `GetDonationResponseSchema` to the existing `@galangdana/contracts` import list at the top of the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/donations.test.ts --env-file=../../.env`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: clean except the 3 documented pre-existing failures.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add GET /donations/:id for status polling"
```

---

### Task 7: Frontend — donation amount page (`/campaign/[slug]/donation-amount`)

**Files:**
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/donation-amount/+page.server.ts`
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/donation-amount/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/donation-amount/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /campaigns/:slug` (existing, from Phase 1), the plain `api` client.
- Produces: the chosen amount, carried forward via a query param (`?amount=`) to `/payment-option` — no server-side "checkout session" exists in this slice, so state is carried in the URL between these three pages, matching a plain multi-step-form pattern. Consumed by Task 8.

- [ ] **Step 1: Write the failing test — `page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

const CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Test Campaign",
  goalAmount: { amount: "10000000", currency: "IDR" },
  collectedAmount: { amount: "2000000", currency: "IDR" },
};

describe("(consumer) campaign/[slug]/donation-amount rendering", () => {
  test("shows the campaign title and an amount input", () => {
    render(Page, { props: { params: { slug: "test-campaign" }, data: { campaign: CAMPAIGN } } });
    expect(screen.getByText("Test Campaign")).not.toBeNull();
    expect(screen.getByLabelText("Nominal donasi")).not.toBeNull();
  });

  test("navigating with an amount goes to the payment-option step", async () => {
    const { goto } = await import("$app/navigation");
    render(Page, { props: { params: { slug: "test-campaign" }, data: { campaign: CAMPAIGN } } });
    await fireEvent.input(screen.getByLabelText("Nominal donasi"), { target: { value: "50000" } });
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith("/campaign/test-campaign/payment-option?amount=50000");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/campaign/[slug]/donation-amount/page.render.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement `+page.server.ts`**

```ts
import { api } from "$lib/api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const { data, error: apiError } = await api.campaigns({ slug: params.slug }).get();
  if (apiError || !data) {
    error(404, "Campaign tidak ditemukan");
  }
  return { campaign: data };
};
```

(Check the exact existing Eden call shape for the campaign-detail endpoint in `apps/web/src/routes/(consumer)/campaign/[slug]/+page.ts` or `+page.server.ts` from Phase 1 -- reuse it verbatim rather than guessing at the path/parameter shape.)

- [ ] **Step 4: Implement `+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data, params }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let amountStr = $state("");
let error = $state<string | null>(null);

function proceed() {
  error = null;
  if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
    error = "Masukkan nominal donasi yang valid.";
    return;
  }
  goto(`/campaign/${params.slug}/payment-option?amount=${amountStr}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">{data.campaign.title}</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <FormField label="Nominal donasi" id="amount">
    <TextInput id="amount" bind:value={amountStr} inputmode="numeric" placeholder="50000" />
  </FormField>

  <Button onclick={proceed}>Lanjutkan</Button>
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/campaign/[slug]/donation-amount/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add donation amount step"
```

---

### Task 8: Frontend — payment option page (`/campaign/[slug]/payment-option`)

**Files:**
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/payment-option/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/payment-option/page.render.test.ts`

**Interfaces:**
- Consumes: the `amount` query param carried from Task 7.
- Produces: the chosen amount, carried forward via query param to `/contribute`. Only one payment method exists in this slice (Bank Transfer VA), so this page's job is honest about that rather than faking a menu -- see Step 4.

No `+page.server.ts` needed -- this page reads `$page.url.searchParams`, no server load required.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$app/stores", () => ({
  page: { subscribe: (fn: (value: unknown) => void) => { fn({ url: new URL("http://localhost/campaign/test-campaign/payment-option?amount=50000"), params: { slug: "test-campaign" } } as never); return () => {}; } },
}));

import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) campaign/[slug]/payment-option rendering", () => {
  test("shows the one available payment method", () => {
    render(Page, { props: { params: { slug: "test-campaign" }, data: {} } });
    expect(screen.getByText(/Transfer Bank \(Virtual Account\)/)).not.toBeNull();
  });

  test("continuing goes to the contribute step with the amount preserved", async () => {
    const { goto } = await import("$app/navigation");
    render(Page, { props: { params: { slug: "test-campaign" }, data: {} } });
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith("/campaign/test-campaign/contribute?amount=50000");
  });
});
```

(This test's `$app/stores` mock shape must match whichever store/rune this codebase's Svelte 5 setup actually uses to read the current URL in a `.svelte` file -- check an existing page in this codebase that reads `$page.url` client-side, e.g. the login page's `redirectTo` derivation (`apps/web/src/routes/login/+page.svelte`) for the real established pattern (`import { page } from "$app/state";` in Svelte 5's SvelteKit, not the older `$app/stores`), and mock whichever module that page actually imports, not the sketch above -- the sketch may be using an outdated SvelteKit API for this codebase's actual version.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/campaign/[slug]/payment-option/page.render.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement `+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Button } from "@galangdana/ui";

const amount = $derived(page.url.searchParams.get("amount") ?? "");

function proceed() {
  goto(`/campaign/${page.params.slug}/contribute?amount=${amount}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Pilih Metode Pembayaran</h1>

  <div class="mb-6 rounded-md border border-neutral-300 p-4">
    <p class="font-sans font-medium text-neutral-900">Transfer Bank (Virtual Account)</p>
    <p class="font-sans text-sm text-neutral-600">Metode pembayaran lain akan segera tersedia.</p>
  </div>

  <Button onclick={proceed}>Lanjutkan</Button>
</div>
```

(This page has no `PageProps`/`+page.server.ts`, matching the `/login` page's precedent of a route with no server load. Adjust the test's `render(Page, { props: {...} })` call to match whatever `PageProps` this route's generated `$types.d.ts` actually requires once the file exists -- it may need only `params`, or nothing at all; check rather than assume.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/campaign/[slug]/payment-option/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add payment option step"
```

---

### Task 9: Frontend — contribute page (`/campaign/[slug]/contribute`)

**Files:**
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/contribute/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/campaign/[slug]/contribute/page.render.test.ts`

**Interfaces:**
- Consumes: the `amount` query param; `POST /donations` (Task 4).
- Produces: on success, redirects to `/donation/status/[id]` (Task 10).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { url: new URL("http://localhost/campaign/test-campaign/contribute?amount=50000"), params: { slug: "test-campaign" } },
}));

import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) campaign/[slug]/contribute rendering", () => {
  test("submitting creates a donation and redirects to the status page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          donationId: "11111111-1111-1111-1111-111111111111",
          vaNumber: "88012345678901",
          amount: { amount: "50000", currency: "IDR" },
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { goto } = await import("$app/navigation");

    render(Page, { props: { params: { slug: "test-campaign" }, data: {} } });
    await fireEvent.click(screen.getByText("Konfirmasi Donasi"));

    await waitFor(() => {
      expect(goto).toHaveBeenCalledWith(
        "/donation/status/11111111-1111-1111-1111-111111111111",
      );
    });
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
      "idempotency-key": expect.any(String),
    });
  });

  test("shows an error message if the donation request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "campaign_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    render(Page, { props: { params: { slug: "test-campaign" }, data: {} } });
    await fireEvent.click(screen.getByText("Konfirmasi Donasi"));
    await waitFor(() => {
      expect(screen.getByText(/Gagal memproses donasi/)).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/campaign/[slug]/contribute/page.render.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement `+page.svelte`**

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { api } from "$lib/api-client";
import { Button } from "@galangdana/ui";

const amount = $derived(page.url.searchParams.get("amount") ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function confirm() {
  error = null;
  submitting = true;
  const { data, error: apiError } = await api.donations.post(
    { campaignId: page.params.slug, amountStr: amount },
    { headers: { "idempotency-key": crypto.randomUUID() } },
  );
  submitting = false;
  if (apiError || !data) {
    error = "Gagal memproses donasi. Silakan coba lagi.";
    return;
  }
  await goto(`/donation/status/${data.donationId}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Konfirmasi Donasi</h1>

  <p class="mb-6 font-sans text-neutral-700">Nominal: Rp{amount}</p>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <Button onclick={confirm} disabled={submitting}>Konfirmasi Donasi</Button>
</div>
```

(**This is wrong as written and you must fix it before committing**: `api.donations({ campaignId: page.params.slug, ... })` passes the campaign's *slug*, but `CreateDonationBodySchema.campaignId` requires the campaign's real UUID `id` — Task 7's `+page.server.ts` already loaded the full campaign object including its `id`. This page currently has no way to know the campaign's id without either (a) its own `+page.server.ts` load calling `GET /campaigns/:slug` again, matching Task 7's exact pattern, or (b) reading it out of query-string state carried forward from Task 7. Prefer (a) — it's one extra small, cheap request and keeps this page self-contained rather than trusting client-supplied state for something that determines which campaign gets donated to. Add a `+page.server.ts` to this task identical in shape to Task 7's, and use `data.campaign.id` in the `POST /donations` call instead of `params.slug`. This was caught in this plan's own self-review, not discovered by you — implement the fix, don't skip it.)

Check `apps/web/src/lib/api-client.ts`'s exact Eden call shape for a route with no hyphenated segments (`api.donations.post(...)`) against how other plain-segment POST routes in this codebase call the client (e.g. `apps/web/src/routes/(consumer)/contact/+page.svelte`'s `api["support-tickets"].post(...)` — note that one needs brackets only because of the hyphen; `donations` has none, so plain dot notation is correct here) — and check whether Eden Treaty's generated client accepts a second `{ headers: {...} }` argument to `.post()` the way sketched above, or whether custom headers are set differently in this codebase's `$lib/api-client` wrapper (check `apps/web/src/lib/api-client.ts` directly rather than assuming Eden's raw API applies unchanged).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/campaign/[slug]/contribute/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add donation confirmation step"
```

---

### Task 10: Frontend — donation status page (`/donation/status/[id]`)

**Files:**
- Create: `apps/web/src/routes/(consumer)/donation/status/[id]/+page.server.ts`
- Create: `apps/web/src/routes/(consumer)/donation/status/[id]/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/donation/status/[id]/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /donations/:id` (Task 6).
- Produces: nothing consumed by a later task — this is a leaf page and the funnel's terminal step.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) donation/status/[id] rendering", () => {
  test("shows the VA number and pending state", () => {
    render(Page, {
      props: {
        params: { id: "1" },
        data: {
          donation: {
            id: "1",
            campaignId: "c1",
            amount: { amount: "50000", currency: "IDR" },
            status: "pending",
            vaNumber: "88012345678901",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            paidAt: null,
          },
        },
      },
    });
    expect(screen.getByText("88012345678901")).not.toBeNull();
    expect(screen.getByText(/Menunggu pembayaran/)).not.toBeNull();
  });

  test("shows a paid confirmation when status is paid", () => {
    render(Page, {
      props: {
        params: { id: "1" },
        data: {
          donation: {
            id: "1",
            campaignId: "c1",
            amount: { amount: "50000", currency: "IDR" },
            status: "paid",
            vaNumber: "88012345678901",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            paidAt: new Date().toISOString(),
          },
        },
      },
    });
    expect(screen.getByText(/Donasi berhasil/)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/donation/status/[id]/page.render.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement `+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client.donations({ id: params.id }).get();
  if (apiError || !data) {
    error(404, "Donasi tidak ditemukan");
  }
  return { donation: data };
};
```

(`createServerApiClient` is used here rather than the plain public `api` client because a logged-in donor's own donation lookup should carry their session cookie -- a guest's lookup still works fine since the endpoint doesn't require auth, per Task 6. If `bun run typecheck` reports response-type over-narrowing on `donation.status`, apply this plan's Global Constraint two-part cast fix.)

- [ ] **Step 4: Implement `+page.svelte`**

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="mx-auto max-w-sm py-12">
  {#if data.donation.status === "paid"}
    <h1 class="mb-4 font-sans text-xl font-bold text-green-700">Donasi berhasil! Terima kasih.</h1>
  {:else}
    <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Menunggu pembayaran</h1>
    <p class="mb-2 font-sans text-neutral-700">Transfer ke nomor Virtual Account berikut:</p>
    <p class="mb-4 font-sans text-2xl font-mono font-bold text-neutral-900">{data.donation.vaNumber}</p>
    <p class="font-sans text-sm text-neutral-600">
      Halaman ini belum memperbarui status secara otomatis -- muat ulang setelah transfer untuk
      melihat status terbaru.
    </p>
  {/if}
</div>
```

(A real product would poll `GET /donations/:id` on an interval or use a websocket/SSE push -- this plan deliberately keeps this page a manual-refresh state display, since building real-time polling infrastructure is separate scope from proving the checkout flow itself works end-to-end. Note this simplification in your report rather than silently building polling infrastructure not asked for by this brief.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/donation/status/[id]/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add donation status page"
```

---

## Self-Review

**Spec coverage:** every piece of the master plan's charge-flow steps 1-5 (`POST /donations` with idempotency, `createCharge`, VA/deeplink return, signature-verified webhook with dedup, one atomic paid transaction incrementing campaign totals) is covered by Tasks 1-6. The three explicitly-required failure-mode tests from the Verification section (duplicate webhook no-op, bad signature reject, double-submit idempotency) are Task 5's and Task 4's own acceptance tests, not deferred. "Out-of-order delivery" and "lost webhook reconciler recovery" are NOT covered — the former needs no explicit test given the atomic-transition guard makes out-of-order delivery structurally safe (a `paid`-then-later-arriving-`pending`-status event would fail the `status = 'pending'` WHERE guard and short-circuit, matching the master plan's "paid never regresses" requirement) but this plan doesn't add a dedicated test proving that; the latter needs a reconciler this plan explicitly defers — both are named in "Explicitly Out of Scope."

**Placeholder scan:** no task contains "TBD," "add appropriate error handling," or an unshown code block for a step that produces code. Two tasks (Task 4 Step 3, Task 9 Step 3) include a note flagging a real issue in the task's OWN sketched code (an awkward type-cast pattern; a slug-vs-id bug) rather than silently shipping broken code disguised as a complete example — the note itself is not a placeholder, it's this plan's own self-review catching two real defects it introduced while writing the tasks, matching this project's established discipline of surfacing findings rather than burying them.

**Type consistency:** `donations`/`payments`/`paymentEvents`/`allocationPolicies`/`idempotencyKeys`/`notificationsOutbox` table and column names are used identically across Tasks 1, 4, 5, 6. `CreateDonationResponseSchema`/`GetDonationResponseSchema`/`PaymentErrorSchema` (Task 2) are used identically in Tasks 4, 5, 6, and referenced correctly by every frontend task. `PaymentProvider`/`MockPaymentProvider`/`ChargeInput`/`ChargeResult`/`WebhookEvent` (Task 3) are constructed identically (`new MockPaymentProvider({ serverKey: ... })`) in Tasks 4 and 5's test files and route code.
