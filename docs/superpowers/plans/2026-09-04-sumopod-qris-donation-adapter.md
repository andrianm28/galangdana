# Sumopod QRIS Donation Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, REAL payment provider — Sumopod's sandbox QRIS payment-link API — alongside the existing `MockPaymentProvider`, so donors can genuinely pick a payment method (Bank Transfer VA or QRIS) at checkout, and QRIS donations flow through a real, externally-verifiable sandbox payment gateway end to end (real charge creation, real hosted payment page, real signature-verified webhook).

**Architecture:** `packages/payments` gains a `SumopodProvider implementing PaymentProvider`, alongside a type-level change (`ChargeResult` becomes a discriminated union on `method`, since Sumopod returns a hosted redirect URL rather than a VA number — architecturally different from every payment method this codebase has handled so far). `apps/api/src/routes/donations.ts`'s `POST /donations` gains a `paymentMethod` selector that picks between the two providers; its webhook-processing logic (the atomic paid-transition, dedup guard, counter increments) is extracted into a shared function reused by both the existing `/payments/webhook` route (mock) and a new `/payments/webhook/sumopod` route (Sumopod's own JSON+svix-header shape can't share one endpoint with Midtrans-shaped webhooks). The frontend's `payment-option` page becomes a real two-method selector (currently a single static, unselectable "coming soon" block), and `donation/status/[id]` branches its rendering on the donation's `method`.

**Tech Stack:** SvelteKit 2, ElysiaJS on Bun, TypeBox contracts + Eden Treaty, Drizzle + Postgres, Bun's native `crypto` (HMAC-SHA256 for svix verification).

**Spec:** No master-plan phase covers this — it's new scope added mid-project because the user supplied real Sumopod sandbox API documentation and credentials, unblocking the master plan's own previously-"unverified vendor" third payment option (`docs/superpowers/plans/...` master plan risk section: "Sumopod (payments)... not designed against until docs supplied"). The authoritative spec for Sumopod's own API is the documentation pasted directly into this session by the user — reproduced verbatim in each task below where its exact request/response shape matters. Do not guess beyond what's reproduced here; if a task needs a Sumopod API behavior not covered by what's quoted, flag it rather than inventing it.

## Global Constraints

- Money stays `bigint` everywhere internally. The ONE place this plan crosses into `Number` is the Sumopod HTTP request body itself, whose `amount` field is a plain JSON number (per their documented example, `"amount": 50000`) — IDR has no minor unit and realistic donation amounts are always far under `Number.MAX_SAFE_INTEGER`, so `Number(amountBigint)` is safe there specifically, and nowhere else.
- `ChargeResult` is a discriminated union on `method`: `{method: "bank_transfer_va", vaNumber: string, ...}` or `{method: "qris_redirect", redirectUrl: string, ...}`. Every consumer (route handlers, DB writes, frontend rendering) must branch on `method`, never assume one shape.
- `WebhookEvent` gains a `provider: string` field, set by each provider's own `parseWebhook` (`"mock"` or `"sumopod"`). The existing webhook-processing code hardcodes `paymentEvents.provider: "mock"` regardless of which provider actually fired — a latent bug that was harmless with only one provider and stops being harmless with two. Fix it to use `event.provider` as part of this plan, not as an afterthought.
- Every status transition keeps using this codebase's established atomic-transition-guard pattern (`UPDATE ... WHERE status = '<expected>' RETURNING`, checking `.length`) — the existing webhook handler's logic is being extracted into a shared function, not rewritten; its guards must survive the extraction unchanged.
- The existing nested-transaction/SAVEPOINT pattern for the `payment_events` dedup guard (a real drizzle-orm/postgres-js gotcha this project already hit once) must be preserved in the extracted shared function — do not flatten it back into a bare try/catch against the outer `tx`.
- Sumopod's webhook signature verification uses svix's scheme: `HMAC-SHA256(base64_decode(secret_after_stripping_"whsec_"_prefix), "${svixId}.${svixTimestamp}.${rawBody}")`, base64-encoded, compared against one or more space-separated `v1,<sig>` values in the `svix-signature` header (multiple values occur for ~24h after a secret rotation — check ALL of them, not just the first). Implement this for real, matching the rigor already used for Midtrans's SHA-512 verification in this codebase (`packages/payments/src/signature.ts`) — do not take the "simpler" `X-Webhook-Token` shortcut Sumopod's docs also offer.
- `SumopodProvider.getStatus` and `SumopodProvider.createPayout` are NOT implemented in this plan — Sumopod's documented API (reproduced in Task 3) shows no get-payment-by-id or disbursement endpoint. Throw a clear "not implemented" error, matching `MockPaymentProvider.createPayout`'s existing precedent for an unsupported operation. Do not invent an endpoint that wasn't documented.
- The Sumopod API key and webhook signing secret are real credentials, already saved outside the repo at `~/.secrets/sumopod` (API key) — never read into this plan's own code, never logged, never committed. Provider construction reads them from `process.env.SUMOPOD_API_KEY` / `process.env.SUMOPOD_WEBHOOK_SECRET` at runtime, exactly like `MOCK_MIDTRANS_SERVER_KEY` already works for the mock provider.
- **Sumopod's webhook signing secret does not exist yet** — their dashboard only generates it after a webhook URL is saved in their Settings tab, which is a manual, out-of-band step (not part of any task below — the controller handles this separately after code lands). Every task's own tests must NOT depend on a real signing secret being configured; `SumopodProvider`'s signature verification must be testable with a fabricated/self-computed HMAC in tests (exactly how `packages/payments/src/signature.test.ts` already tests Midtrans's scheme without hitting a real server).
- Frontend method threading follows the established query-param convention already used for `amount` (`donation-amount` → `payment-option` → `contribute`): `paymentMethod` is threaded the same way, as a URL search param, not client-side component state that would be lost on navigation.
- Every new backend route/function gets full `bun test` coverage hitting the real Elysia app against real Postgres — this codebase's established convention, no mocked DB layer. Every new/changed frontend page gets a `page.render.test.ts` using `@testing-library/svelte` against `happy-dom`.
- Eden Treaty: kebab-case route segments need bracket notation; a route tree mixing a collection-level verb with dynamic `:id` sub-routes needs an `as any` cast + `biome-ignore` comment at the call site, re-cast to the real `Treaty.TreatyResponse<{...}>` shape — the established pattern throughout this codebase's frontend tasks.

## File Structure

```
packages/db/src/schema/
  payments.ts                 modify — add nullable redirectUrl column

packages/db/drizzle/          new migration (generated, not hand-written)

packages/contracts/src/
  payments.ts                 modify — paymentMethod in the create-donation body,
                               method + nullable vaNumber/redirectUrl in both responses

packages/payments/src/
  types.ts                    modify — PaymentMethod union, ChargeResult discriminated union,
                               WebhookEvent.provider field
  mock-provider.ts            modify — parseWebhook sets provider: "mock"
  sumopod-provider.ts         new — SumopodProvider implementing PaymentProvider
  sumopod-signature.ts        new — svix HMAC verification (mirrors signature.ts's structure)
  sumopod-provider.test.ts    new
  sumopod-signature.test.ts   new
  index.ts                    modify — export SumopodProvider

apps/api/src/routes/
  donations.ts                modify — paymentMethod-based provider selection, extracted
                               shared webhook-processing function, new
                               POST /payments/webhook/sumopod route
  donations.test.ts           modify — new tests for the above
  disbursements.test.ts       modify — one-line createPaidDonation fixture fix (required, not optional)

apps/web/src/routes/(consumer)/campaign/[slug]/
  payment-option/+page.svelte              modify — real 2-method selector
  payment-option/page.render.test.ts       modify
  contribute/+page.svelte                  modify — thread paymentMethod into POST /donations
  contribute/page.render.test.ts           modify

apps/web/src/routes/(consumer)/donation/status/[id]/
  +page.svelte                             modify — branch rendering on donation.method
  page.render.test.ts                      modify
```

---

## Task 1: Schema — add `redirectUrl` to `payments`

**Files:**
- Modify: `packages/db/src/schema/payments.ts`
- Test: `packages/db/src/__tests__/payments.test.ts` (extend the existing file)

**Interfaces:**
- Produces: `payments.redirectUrl` (nullable text column).

- [ ] **Step 1: Add the column**

Modify `packages/db/src/schema/payments.ts` — add one line alongside the existing `vaNumber` column:

```typescript
  vaNumber: text("va_number"),
  redirectUrl: text("redirect_url"),
```

(Insert `redirectUrl` immediately after `vaNumber` in the column list. No other change to this file — `method`/`provider` are already plain `text`, no enum constraint blocks the new `"qris_redirect"`/`"sumopod"` values this plan introduces elsewhere.)

- [ ] **Step 2: Generate and review the migration**

```bash
cd packages/db && bun run drizzle-kit generate
```

Confirm the generated SQL is exactly `ALTER TABLE "payments" ADD COLUMN "redirect_url" text;` (nullable, no default needed — every existing row is a VA-based payment and correctly has `redirect_url = NULL`). Apply it against the dev DB (check `package.json` for the real migrate command — likely `bun run db:migrate` from the repo root, confirm rather than assume) and confirm it applies cleanly.

- [ ] **Step 3: Extend `packages/db/src/__tests__/payments.test.ts`**

Add one test alongside whatever's already there: insert a payment row with `redirectUrl` set (and `vaNumber` left `null`, since the two are mutually exclusive per this plan's design), confirm it round-trips correctly. Read the existing file first to match its exact fixture-setup convention (how it creates a prerequisite `donations` row, etc.) rather than inventing a new one.

- [ ] **Step 4: Run tests, lint, typecheck**

```bash
cd packages/db && bun test src/__tests__/payments.test.ts --env-file=../../.env
cd /path/to/repo/root && bun run lint && bun run typecheck
```

Confirm the repo-root `bun run test` baseline is unchanged (338 pass / 3 known pre-existing fail).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/payments.ts packages/db/drizzle/ packages/db/src/__tests__/payments.test.ts
git commit -m "feat(db): add payments.redirect_url for hosted-checkout-link payment methods"
```

---

## Task 2: Contracts

**Files:**
- Modify: `packages/contracts/src/payments.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CreateDonationBodySchema` with `paymentMethod`; `CreateDonationResponseSchema`/`GetDonationResponseSchema` with `method` + nullable `vaNumber`/`redirectUrl`.

- [ ] **Step 1: Add a `PaymentMethodSchema` and thread it through the existing schemas**

Rewrite `packages/contracts/src/payments.ts` in full:

```typescript
import { type Static, Type } from "@sinclair/typebox";
import { MoneyJSONSchema } from "./campaigns";

export const PaymentErrorSchema = Type.Object({ error: Type.String() });

export const PaymentMethodSchema = Type.Union([
  Type.Literal("bank_transfer_va"),
  Type.Literal("qris_redirect"),
]);

export const CreateDonationBodySchema = Type.Object({
  campaignId: Type.String({ format: "uuid" }),
  // Minor-unit rupiah as a decimal string, never a JSON number -- same
  // convention as SaveCampaignGoalAmountBodySchema.
  amountStr: Type.String({ pattern: "^\\d+$", maxLength: 15 }),
  paymentMethod: PaymentMethodSchema,
  isAnonymous: Type.Optional(Type.Boolean()),
  comment: Type.Optional(Type.String({ maxLength: 500 })),
});

export const CreateDonationResponseSchema = Type.Object({
  donationId: Type.String({ format: "uuid" }),
  method: PaymentMethodSchema,
  vaNumber: Type.Union([Type.String(), Type.Null()]),
  redirectUrl: Type.Union([Type.String(), Type.Null()]),
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
  method: PaymentMethodSchema,
  vaNumber: Type.Union([Type.String(), Type.Null()]),
  redirectUrl: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.String({ format: "date-time" }),
  paidAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});
export type GetDonationResponse = Static<typeof GetDonationResponseSchema>;
```

`CreateDonationResponseSchema.method`/`vaNumber`/`redirectUrl` are new fields — every existing caller of this schema (Task 4's route, Task 6's frontend) must be updated to populate/consume them; that's this plan's own job in later tasks, not a concern for this task itself beyond getting the schema shape right.

- [ ] **Step 2: Run lint/typecheck**

```bash
bun run lint && bun run typecheck
```

(Typecheck will show new errors in `apps/api/src/routes/donations.ts` and the frontend pages until Tasks 4/6/7 update them — that's expected at this point in the plan; confirm the errors are exactly the ones you'd expect from this schema change, not something unrelated.)

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/payments.ts
git commit -m "feat(contracts): add paymentMethod selection and polymorphic charge-result fields"
```

---

## Task 3: `packages/payments` — types + SumopodProvider

**Files:**
- Modify: `packages/payments/src/types.ts`
- Modify: `packages/payments/src/mock-provider.ts`
- Create: `packages/payments/src/sumopod-signature.ts`
- Create: `packages/payments/src/sumopod-provider.ts`
- Create: `packages/payments/src/sumopod-signature.test.ts`
- Create: `packages/payments/src/sumopod-provider.test.ts`
- Modify: `packages/payments/src/index.ts`

**Interfaces:**
- Produces: `SumopodProvider implementing PaymentProvider`, `verifySumopodSignature`, updated `PaymentMethod`/`ChargeResult`/`WebhookEvent` types.

**The authoritative Sumopod API reference for this task** (reproduced verbatim from the documentation supplied by the user — do not guess beyond this):

Create Payment — `POST https://api-pay-sandbox.sumopod.com/api/v1/payments`, header `X-Api-Key: <key>`, `Content-Type: application/json`. Request body:
```json
{
  "order_id": "INV-2026-001",
  "amount": 50000,
  "currency": "IDR",
  "expires_in_hours": 24,
  "success_return_url": "https://yourapp.com/success",
  "cancel_return_url": "https://yourapp.com/cancel",
  "payment_method_type_code": "QRIS"
}
```
`expires_in_hours` is optional, defaults to 24, max 24. `success_return_url`/`cancel_return_url` are optional overrides. `payment_method_type_code` is optional — the account's supported methods are `QRIS` (settles in 2 days, fee 0.7% + Rp300) and `QRIS_INSTANT` (settles in 0 days, fee 1.5% + Rp300); use `QRIS` for this plan.

Response:
```json
{
  "payment_id": "uuid",
  "order_id": "INV-2026-001",
  "amount": 50000,
  "fee": 750,
  "net_amount": 49250,
  "payment_link_url": "https://pay.sumopod.com/pay/uuid",
  "status": "pending",
  "expires_at": "2026-01-01T12:00:00Z"
}
```

Webhook events (`POST` to whatever URL is configured in Sumopod's dashboard Settings — out of this task's scope, handled after code lands): `payment.completed`, `payment.failed`, `payment.expired`, `payment.test`. Payload:
```json
{
  "event_type": "payment.completed",
  "data": {
    "payment_id": "uuid",
    "order_id": "INV-2026-001",
    "amount": 50000,
    "fee": 750,
    "net_amount": 49250,
    "status": "completed",
    "payment_method": "qris",
    "completed_at": "2026-06-18T12:00:00Z"
  }
}
```
Verification headers: `svix-id`, `svix-timestamp`, `svix-signature`. Signature scheme (Node.js reference from the docs):
```javascript
const crypto = require("crypto");
function verifyWebhookSignature(secret, svixId, svixTimestamp, svixSignature, rawBody) {
  const secretBytes = Buffer.from(secret.replace("whsec_", ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  // svix-signature may contain multiple space-separated "v1,<sig>" values
  const signatures = svixSignature.split(" ").map((s) => s.split(",")[1]);
  return signatures.includes(expectedSignature);
}
```
The endpoint must respond 2xx within 10 seconds.

- [ ] **Step 1: Update `types.ts`**

```typescript
export type PaymentMethod = "bank_transfer_va" | "qris_redirect";

export interface ChargeInput {
  orderId: string;
  grossAmount: bigint;
  currency: "IDR" | "USD";
  // Only meaningful for redirect-based methods (Sumopod) -- where to send
  // the donor after they finish (or cancel) on the provider's hosted page.
  // Ignored by providers that don't need it (the mock VA flow).
  successReturnUrl?: string;
  cancelReturnUrl?: string;
}

export type ChargeResult =
  | {
      providerOrderId: string;
      method: "bank_transfer_va";
      vaNumber: string;
      expiresAt: Date;
    }
  | {
      providerOrderId: string;
      method: "qris_redirect";
      redirectUrl: string;
      expiresAt: Date;
    };

export interface WebhookEvent {
  // "mock" | "sumopod" -- which provider actually delivered this event.
  // The webhook-processing code uses this for the payment_events dedup
  // guard's UNIQUE(provider, providerEventId) constraint; it was
  // previously hardcoded to the literal "mock" everywhere, which was
  // silently wrong (harmless with one provider, not with two).
  provider: string;
  providerEventId: string;
  providerOrderId: string;
  status: "paid" | "failed" | "expired";
  rawPayload: unknown;
}

export interface PaymentStatus {
  providerOrderId: string;
  status: "pending" | "paid" | "failed" | "expired";
}

/**
 * Field names mirror Xendit's current Payouts API v2 (reference_id +
 * channel_code + channel_properties), not the older Disbursement API's
 * external_id/bank_code -- verified via docs.xendit.co, see mock-provider.ts's
 * createPayout for detail. accountNumber/accountHolderName correspond to
 * Xendit's nested channel_properties object; channelCode is e.g. "ID_BCA".
 */
export interface PayoutInput {
  referenceId: string;
  amount: bigint;
  channelCode: string;
  accountNumber: string;
  accountHolderName: string;
  description: string;
}

export interface PayoutResult {
  payoutId: string;
  status: "pending" | "completed" | "failed";
}

export interface PaymentProvider {
  createCharge(input: ChargeInput): Promise<ChargeResult>;
  parseWebhook(req: Request): Promise<WebhookEvent>;
  getStatus(orderId: string): Promise<PaymentStatus>;
  createPayout(input: PayoutInput): Promise<PayoutResult>;
}
```

- [ ] **Step 2: Update `mock-provider.ts`'s `parseWebhook`**

Find the `return { providerEventId: ..., providerOrderId: ..., status, rawPayload: body };` at the end of `parseWebhook`, add `provider: "mock",` as the first field:

```typescript
    return {
      provider: "mock",
      providerEventId: String(body.transaction_id ?? ""),
      providerOrderId: orderId,
      status,
      rawPayload: body,
    };
```

No other change to this file — `createCharge`'s existing return already structurally satisfies the new `ChargeResult`'s `bank_transfer_va` variant (it already returns `method: "bank_transfer_va"` alongside `vaNumber`).

- [ ] **Step 3: Write `sumopod-signature.ts`**

**Confirmed by reading the real `packages/payments/src/signature.ts` during this plan's writing: this package's established convention is the Web Crypto API (`crypto.subtle`, a global — no import needed), NOT Node's `crypto` module.** `verifyMidtransSignature` is `async` for exactly this reason (`crypto.subtle` is promise-based). Match this exactly — do not use `node:crypto`'s `createHmac`.

```typescript
/**
 * Verifies a Sumopod webhook's svix-style signature. Mirrors this
 * package's own signature.ts (Midtrans's SHA-512 scheme) in spirit --
 * real HMAC verification via the Web Crypto API, not the "simpler"
 * X-Webhook-Token shared-secret shortcut Sumopod's docs also offer,
 * matching this codebase's established bar for webhook security.
 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function computeHmacSha256Base64(secretBytes: Uint8Array, content: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return bytesToBase64(signature);
}

/**
 * Length-checked, byte-by-byte comparison rather than `===` -- same
 * rationale as signature.ts's own constantTimeEqual: don't leak timing
 * information about how much of the expected signature matched.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifySumopodSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string,
): Promise<boolean> {
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = await computeHmacSha256Base64(secretBytes, signedContent);

  // svix-signature may contain multiple space-separated "v1,<sig>" values
  // (this happens for ~24h after rotating the secret) -- check all of them,
  // not just the first.
  const candidates = svixSignature
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter((s): s is string => Boolean(s));

  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}
```

- [ ] **Step 4: Write `sumopod-signature.test.ts`**

Test using a self-computed HMAC (no real Sumopod server needed, per the Global Constraints — the real signing secret doesn't exist yet):

```typescript
import { describe, expect, test } from "bun:test";
import { verifySumopodSignature } from "./sumopod-signature";

const SECRET = "whsec_dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz"; // "test-secret-key-for-unit-tests" base64
const SVIX_ID = "msg_test123";
const SVIX_TIMESTAMP = "1700000000";
const RAW_BODY = JSON.stringify({ event_type: "payment.completed", data: { order_id: "x" } });

// Uses the same Web Crypto API as sumopod-signature.ts itself -- not
// node:crypto -- so this test is computing the signature the exact same
// way the real verification will, just independently (a self-consistency
// check would be worthless if both sides used a different HMAC
// implementation and happened to agree by coincidence).
async function computeSignature(secret: string, svixId: string, svixTimestamp: string, body: string) {
  function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return `v1,${sig}`;
}

describe("verifySumopodSignature", () => {
  test("accepts a correctly computed signature", async () => {
    const sig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, sig, RAW_BODY)).toBe(true);
  });

  test("rejects a tampered body", async () => {
    const sig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    const tamperedBody = JSON.stringify({ event_type: "payment.completed", data: { order_id: "y" } });
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, sig, tamperedBody)).toBe(false);
  });

  test("rejects a wrong secret", async () => {
    const sig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    const wrongSecret = "whsec_d3Jvbmctc2VjcmV0LWtleS1mb3ItdGVzdHM=";
    expect(await verifySumopodSignature(wrongSecret, SVIX_ID, SVIX_TIMESTAMP, sig, RAW_BODY)).toBe(false);
  });

  test("accepts when the correct signature is one of several space-separated candidates", async () => {
    const correctSig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    const decoySig = "v1,bm90LXRoZS1yaWdodC1zaWduYXR1cmU=";
    const combined = `${decoySig} ${correctSig}`;
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, combined, RAW_BODY)).toBe(true);
  });

  test("rejects when no candidate matches", async () => {
    const decoySig = "v1,bm90LXRoZS1yaWdodC1zaWduYXR1cmU=";
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, decoySig, RAW_BODY)).toBe(false);
  });
});
```

- [ ] **Step 5: Write `sumopod-provider.ts`**

```typescript
import { verifySumopodSignature } from "./sumopod-signature";
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  PaymentStatus,
  PayoutInput,
  PayoutResult,
  WebhookEvent,
} from "./types";

export class SumopodProvider implements PaymentProvider {
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;

  constructor(config: { apiKey: string; webhookSecret: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.webhookSecret = config.webhookSecret;
    this.baseUrl = config.baseUrl ?? "https://api-pay-sandbox.sumopod.com";
  }

  async createCharge(input: ChargeInput): Promise<ChargeResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        order_id: input.orderId,
        // IDR has no minor unit; realistic donation amounts are far under
        // Number.MAX_SAFE_INTEGER, so this bigint->Number crossing is safe
        // -- Sumopod's API is a plain-JSON-number wire format, this is the
        // one place in this codebase's payment code that isn't bigint.
        amount: Number(input.grossAmount),
        currency: input.currency,
        expires_in_hours: 24,
        success_return_url: input.successReturnUrl,
        cancel_return_url: input.cancelReturnUrl,
        payment_method_type_code: "QRIS",
      }),
    });

    if (!res.ok) {
      throw new Error(`Sumopod createCharge failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      payment_id: string;
      order_id: string;
      payment_link_url: string;
      expires_at: string;
    };

    return {
      providerOrderId: data.payment_id,
      method: "qris_redirect",
      redirectUrl: data.payment_link_url,
      expiresAt: new Date(data.expires_at),
    };
  }

  async parseWebhook(req: Request): Promise<WebhookEvent> {
    const rawBody = await req.text();
    const svixId = req.headers.get("svix-id") ?? "";
    const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
    const svixSignature = req.headers.get("svix-signature") ?? "";

    const valid = await verifySumopodSignature(
      this.webhookSecret,
      svixId,
      svixTimestamp,
      svixSignature,
      rawBody,
    );
    if (!valid) {
      throw new Error("invalid webhook signature");
    }

    const body = JSON.parse(rawBody) as {
      event_type: string;
      data: { payment_id: string; order_id: string; status: string };
    };

    const status: WebhookEvent["status"] =
      body.event_type === "payment.completed"
        ? "paid"
        : body.event_type === "payment.expired"
          ? "expired"
          : "failed";

    return {
      provider: "sumopod",
      // Sumopod doesn't send a distinct delivery/event id in the payload
      // shown in their docs -- payment_id is the closest stable per-payment
      // identifier. This means a genuine retry of the SAME event (same
      // payment_id, same event_type) would collide on the payment_events
      // dedup guard's UNIQUE(provider, providerEventId) constraint and be
      // correctly treated as a no-op duplicate -- which is the guard's
      // actual job. If Sumopod's real delivery includes a distinct event
      // id under a field this documentation excerpt didn't show, prefer
      // that instead; this is the best available identifier from what was
      // documented.
      providerEventId: `${body.data.payment_id}:${body.event_type}`,
      providerOrderId: body.data.order_id,
      status,
      rawPayload: body,
    };
  }

  async getStatus(_orderId: string): Promise<PaymentStatus> {
    throw new Error(
      "SumopodProvider.getStatus is not implemented -- no get-payment-by-id endpoint was documented",
    );
  }

  async createPayout(_input: PayoutInput): Promise<PayoutResult> {
    throw new Error(
      "SumopodProvider.createPayout is not implemented -- Sumopod's documented API has no disbursement endpoint",
    );
  }
}
```

- [ ] **Step 6: Write `sumopod-provider.test.ts`**

Test `createCharge` and `parseWebhook` against a real local HTTP server you spin up in the test (mirroring how `parseWebhook`'s tests elsewhere in this package construct a real `Request` object) rather than mocking `fetch` at the module level — check how `mock-provider.test.ts` or `signature.test.ts` structure their own tests first and match the established convention in this exact package. At minimum:
- `createCharge` sends the right request body shape (assert on a captured request, using a local `Bun.serve` stub that returns a canned Sumopod-shaped response) and correctly maps the response to `{method: "qris_redirect", redirectUrl, providerOrderId, expiresAt}`.
- `parseWebhook` with a validly-signed `payment.completed` body returns `status: "paid"`, `provider: "sumopod"`.
- `parseWebhook` with an invalid signature throws.
- `parseWebhook` maps `payment.failed` → `"failed"`, `payment.expired` → `"expired"`.
- `getStatus`/`createPayout` both throw with a clear message (matching `mock-provider.test.ts`'s existing test for `createPayout`'s pre-Phase-6 not-implemented state, if that test is still findable in history for reference).

- [ ] **Step 7: Update `index.ts`**

Confirmed by reading the real file during this plan's writing — it currently reads:
```typescript
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
Add, mirroring the exact same pattern (individual named exports, signature functions exported alongside the provider class):
```typescript
export { verifySumopodSignature } from "./sumopod-signature";
export { SumopodProvider } from "./sumopod-provider";
```
`ChargeInput`/`ChargeResult`/`PaymentMethod`/`WebhookEvent` are already exported as types — no change needed there since this plan modifies those types in-place rather than adding new type names.

- [ ] **Step 8: Run tests, lint, typecheck**

```bash
cd packages/payments && bun test
cd /path/to/repo/root && bun run lint && bun run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add packages/payments/
git commit -m "feat(payments): add SumopodProvider (real QRIS payment-link adapter)"
```

---

## Task 4: `apps/api` — provider selection, shared webhook processing, Sumopod webhook route

**Files:**
- Modify: `apps/api/src/routes/donations.ts`
- Modify: `apps/api/src/routes/donations.test.ts`
- Modify: `apps/api/src/routes/disbursements.test.ts` — one-line fix to its `createPaidDonation` helper, required to prevent a real cross-file break (see Step 8)

**Interfaces:**
- Consumes: `SumopodProvider`, `PaymentMethod`, `ChargeResult`, `WebhookEvent` from Task 3; `paymentMethod`/`method`/`redirectUrl` from Task 2's contracts.
- Produces: `getProvider(method)`, a shared `processPaymentWebhookEvent(event)` function, `POST /payments/webhook/sumopod`.

**Before Step 1:** this file already exists as one complete, semicolon-terminated `export const donationsRoute = new Elysia()....` statement (no chain-continuation situation — unlike some earlier plans in this project, this is a normal single-task edit to an already-complete file). Open it, make the changes below, keep it as one statement.

- [ ] **Step 1: Generalize `getProvider`**

Find:
```typescript
const SERVER_KEY = process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev";

function getProvider() {
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}
```

Replace with:

```typescript
import { MockPaymentProvider, SumopodProvider } from "@galangdana/payments";
import type { PaymentMethod } from "@galangdana/payments";

const SERVER_KEY = process.env.MOCK_MIDTRANS_SERVER_KEY ?? "mock-server-key-for-dev";
const SUMOPOD_API_KEY = process.env.SUMOPOD_API_KEY ?? "";
const SUMOPOD_WEBHOOK_SECRET = process.env.SUMOPOD_WEBHOOK_SECRET ?? "";

function getProvider(method: PaymentMethod) {
  if (method === "qris_redirect") {
    return new SumopodProvider({ apiKey: SUMOPOD_API_KEY, webhookSecret: SUMOPOD_WEBHOOK_SECRET });
  }
  return new MockPaymentProvider({ serverKey: SERVER_KEY });
}

function getSumopodProvider() {
  return new SumopodProvider({ apiKey: SUMOPOD_API_KEY, webhookSecret: SUMOPOD_WEBHOOK_SECRET });
}
```

(Adjust the existing `import` block at the top of the file rather than adding a second one — merge `SumopodProvider`/`PaymentMethod` into whatever import statement already pulls `MockPaymentProvider` from `@galangdana/payments`.)

- [ ] **Step 2: Thread `paymentMethod` through `POST /donations`**

Find the `body: CreateDonationBodySchema` handler. The provider call currently reads:
```typescript
        const donationId = crypto.randomUUID();
        const provider = getProvider();
        const charge = await provider.createCharge({
          orderId: donationId,
          grossAmount: amount,
          currency: campaign.currency,
        });
```

Replace with:
```typescript
        const donationId = crypto.randomUUID();
        const provider = getProvider(body.paymentMethod);
        const publicWebUrl = process.env.PUBLIC_WEB_URL ?? "http://localhost:5173";
        const charge = await provider.createCharge({
          orderId: donationId,
          grossAmount: amount,
          currency: campaign.currency,
          successReturnUrl: `${publicWebUrl}/donation/status/${donationId}`,
          cancelReturnUrl: `${publicWebUrl}/donation/status/${donationId}`,
        });
```

(Both return URLs point at the same status page — it already renders whatever the donation's current status is, whether the donor completed payment or cancelled, so a single destination is correct; `MockPaymentProvider.createCharge` ignores these two new `ChargeInput` fields entirely, no change needed there.)

Then the `payments` insert and response-body construction, currently:
```typescript
          await tx.insert(payments).values({
            donationId,
            provider: "mock",
            method: charge.method,
            providerOrderId: charge.providerOrderId,
            vaNumber: charge.vaNumber,
            grossAmount: amount,
            expiresAt: charge.expiresAt,
          });

          const body_: Static<typeof CreateDonationResponseSchema> = {
            donationId,
            vaNumber: charge.vaNumber,
            amount: moneyToJSON({ amount, currency: campaign.currency }),
            expiresAt: charge.expiresAt.toISOString(),
          };
```

Replace with (branching on `charge.method` since `vaNumber`/`redirectUrl` only exist on one side of the discriminated union each):
```typescript
          await tx.insert(payments).values({
            donationId,
            provider: charge.method === "qris_redirect" ? "sumopod" : "mock",
            method: charge.method,
            providerOrderId: charge.providerOrderId,
            vaNumber: charge.method === "bank_transfer_va" ? charge.vaNumber : null,
            redirectUrl: charge.method === "qris_redirect" ? charge.redirectUrl : null,
            grossAmount: amount,
            expiresAt: charge.expiresAt,
          });

          const body_: Static<typeof CreateDonationResponseSchema> = {
            donationId,
            method: charge.method,
            vaNumber: charge.method === "bank_transfer_va" ? charge.vaNumber : null,
            redirectUrl: charge.method === "qris_redirect" ? charge.redirectUrl : null,
            amount: moneyToJSON({ amount, currency: campaign.currency }),
            expiresAt: charge.expiresAt.toISOString(),
          };
```

- [ ] **Step 3: Extract the shared webhook-processing function**

The existing `/payments/webhook` handler's body — everything from `const result = await db.transaction(async (tx) => { ... });` through the final `return { status: result.alreadyProcessed ? "already_processed" : "processed" };` — becomes a standalone function taking the already-parsed `event: WebhookEvent`, placed above both webhook route definitions:

```typescript
async function processPaymentWebhookEvent(event: WebhookEvent) {
  const result = await db.transaction(async (tx) => {
    // First write: the dedup guard. See this file's own established
    // comment (already present, unchanged) explaining why this MUST be a
    // nested tx.transaction() (SAVEPOINT), not a bare try/catch against
    // the outer tx -- postgres.js's begin() tracks the first error seen by
    // ANY query run through its transaction-scoped sql tag independent of
    // any JS-level catch.
    try {
      await tx.transaction(async (tx2) => {
        await tx2.insert(paymentEvents).values({
          provider: event.provider,
          providerEventId: event.providerEventId,
          payload: event.rawPayload as object,
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return { alreadyProcessed: true as const };
      }
      throw err;
    }

    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, event.providerOrderId));
    if (!payment) {
      throw new Error(`webhook for unknown providerOrderId: ${event.providerOrderId}`);
    }

    if (event.status !== "paid") {
      const now = new Date();
      const updatedDonations = await tx
        .update(donations)
        .set({ status: event.status, updatedAt: now })
        .where(and(eq(donations.id, payment.donationId), eq(donations.status, "pending")))
        .returning();
      if (updatedDonations.length === 0) {
        return { alreadyProcessed: true as const };
      }

      await tx
        .update(payments)
        .set({ status: event.status, updatedAt: now })
        .where(
          and(eq(payments.providerOrderId, event.providerOrderId), ne(payments.status, "paid")),
        );
      return { alreadyProcessed: false as const, paid: false as const };
    }

    const now = new Date();
    const updatedDonations = await tx
      .update(donations)
      .set({ status: "paid", paidAt: now, updatedAt: now })
      .where(and(eq(donations.id, payment.donationId), eq(donations.status, "pending")))
      .returning();
    if (updatedDonations.length === 0) {
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
}
```

(Copy the REAL current body of the handler from the file rather than retyping from this sketch — this plan's reproduction above should match, but the file is the source of truth; if anything differs, prefer what's actually in the file, e.g. exact variable names, and carry it into the extracted function unchanged. The `notificationsOutbox` insert may or may not already be present depending on the exact current state — include it if it's there.)

- [ ] **Step 4: Slim down `POST /payments/webhook` to use the extracted function**

```typescript
  .post(
    "/payments/webhook",
    async ({ request, set }) => {
      const provider = getProvider("bank_transfer_va");
      let event: WebhookEvent;
      try {
        event = await provider.parseWebhook(request);
      } catch {
        set.status = 401;
        return { error: "invalid_signature" };
      }
      return processPaymentWebhookEvent(event);
    },
    {
      response: {
        200: t.Object({ status: t.String() }),
        401: PaymentErrorSchema,
      },
    },
  )
```

- [ ] **Step 5: Add `POST /payments/webhook/sumopod`**

```typescript
  .post(
    "/payments/webhook/sumopod",
    async ({ request, set }) => {
      const provider = getSumopodProvider();
      let event: WebhookEvent;
      try {
        event = await provider.parseWebhook(request);
      } catch {
        set.status = 401;
        return { error: "invalid_signature" };
      }
      return processPaymentWebhookEvent(event);
    },
    {
      response: {
        200: t.Object({ status: t.String() }),
        401: PaymentErrorSchema,
      },
    },
  )
```

- [ ] **Step 6: `GET /donations/:id`'s response mapping**

Find the response object construction (currently returns `vaNumber` directly from `row.payment.vaNumber`). Update to include `method` and `redirectUrl`:

```typescript
      return {
        id: row.donation.id,
        campaignId: row.donation.campaignId,
        amount: moneyToJSON({ amount: row.donation.amount, currency: row.donation.currency }),
        status: row.donation.status,
        method: row.payment.method as "bank_transfer_va" | "qris_redirect",
        vaNumber: row.payment.vaNumber,
        redirectUrl: row.payment.redirectUrl,
        expiresAt: row.payment.expiresAt.toISOString(),
        paidAt: row.donation.paidAt?.toISOString() ?? null,
      };
```

- [ ] **Step 7: Extend `donations.test.ts`**

Cover, against the real Elysia app + real Postgres:
- `POST /donations` with `paymentMethod: "bank_transfer_va"` behaves exactly as before (existing tests should mostly just need `paymentMethod: "bank_transfer_va"` added to their request bodies — go through the existing test file and add it everywhere a donation-creation request body is built, rather than leaving old tests broken by the new required field).
- `POST /donations` with `paymentMethod: "qris_redirect"` — this one CANNOT hit the real Sumopod sandbox in a test (no real webhook secret configured yet, and hitting a real third-party API from the test suite would make tests flaky/network-dependent). Use a test-only fake: check whether this task should inject a test double for `SumopodProvider`, or whether the cleanest approach is testing `getProvider("qris_redirect")` returns a `SumopodProvider` instance via a narrower unit-level check, and leave the actual charge-creation network call path to Task 3's own `SumopodProvider` tests (which already cover `createCharge` against a local stub server) rather than re-testing it here through the full route. Prefer NOT hitting the real Sumopod API from this file's tests — if there's no clean way to test the full `qris_redirect` path through `POST /donations` without a real network call, note that gap explicitly in your report rather than silently skipping coverage.
- `POST /payments/webhook/sumopod` with a validly-signed payload (construct the signature the same way `sumopod-signature.test.ts` does) correctly transitions a `qris_redirect` donation to `paid`, increments campaign counters — mirroring the existing `/payments/webhook` tests' structure exactly, just against the new route and a Sumopod-shaped payload. You'll need a webhook secret for this test — since the real one doesn't exist yet, set `SUMOPOD_WEBHOOK_SECRET` to a fixed test value via the test's own environment (check how `MOCK_MIDTRANS_SERVER_KEY` is supplied to existing tests — likely already set in `.env` or the test setup — and add an equivalent `SUMOPOD_WEBHOOK_SECRET` test value the same way).
- An invalid signature on `/payments/webhook/sumopod` returns 401 and touches no DB rows.
- `GET /donations/:id` returns `method`/`redirectUrl` correctly for both a VA-based and (if feasible per the note above) a redirect-based donation.
- The `payment_events.provider` fix: a paid webhook (either route) writes the RIGHT provider string (`"mock"` or `"sumopod"`), not a hardcoded value — add a direct DB assertion for this on at least one test per route.

- [ ] **Step 8: Fix the cross-file break in `disbursements.test.ts` — required, not optional**

Confirmed during this plan's writing: `apps/api/src/routes/disbursements.test.ts` has its own `createPaidDonation(campaignId, amountStr)` helper (around line 201) that builds a `POST /donations` request body directly:
```typescript
      body: JSON.stringify({ campaignId, amountStr }),
```
This helper is called 10+ times across that entire test file (Phase 6's whole disbursement test suite depends on it to create real paid donations as fixtures). Once `paymentMethod` becomes required in `CreateDonationBodySchema` (Task 2), every one of those calls fails request validation and the ENTIRE `disbursements.test.ts` file breaks — a real, load-bearing regression exactly one file away from the one you're editing, not a hypothetical.

**Fix:** in `disbursements.test.ts`'s `createPaidDonation` helper, change the body to:
```typescript
      body: JSON.stringify({ campaignId, amountStr, paymentMethod: "bank_transfer_va" }),
```
That's the only change needed in that file — the helper's callers don't need to change, since `paymentMethod` is an internal detail of how the fixture donation gets created, not something any caller passes in. Run `disbursements.test.ts` after this one-line fix to confirm the whole file (43+ tests) passes again.

Also grep the rest of the repo for any OTHER direct `POST /donations` body construction in tests you haven't already touched in this task's own Step 7 changes, in case there's a third call site beyond `donations.test.ts` and `disbursements.test.ts`:
```bash
grep -rn '"/donations"' apps/api/src --include="*.test.ts"
```

- [ ] **Step 9: Run tests, lint, typecheck**

```bash
cd apps/api && bun test src/routes/donations.test.ts src/routes/disbursements.test.ts --env-file=../../.env
cd /path/to/repo/root && bun run test --env-file=.env && bun run lint && bun run typecheck
```

Confirm the repo-root full-suite baseline is still exactly 338 pass / 3 known-pre-existing fail — not fewer passes than before (which would mean `disbursements.test.ts` or another file silently broke).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/routes/donations.ts apps/api/src/routes/donations.test.ts apps/api/src/routes/disbursements.test.ts
git commit -m "feat(api): add paymentMethod selection, Sumopod webhook route, shared webhook processing"
```

---

## Task 5: Frontend — real payment-method selection + threading

**Files:**
- Modify: `apps/web/src/routes/(consumer)/campaign/[slug]/payment-option/+page.svelte`
- Modify: `apps/web/src/routes/(consumer)/campaign/[slug]/payment-option/page.render.test.ts`
- Modify: `apps/web/src/routes/(consumer)/campaign/[slug]/contribute/+page.svelte`
- Modify: `apps/web/src/routes/(consumer)/campaign/[slug]/contribute/page.render.test.ts`

**Interfaces:**
- Consumes: `POST /donations` now requires `paymentMethod` in its body (Task 4).

- [ ] **Step 1: `payment-option/+page.svelte`** — replace the single static block with a real two-option selector, carrying `paymentMethod` forward as a query param alongside the existing `amount`:

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Button } from "@galangdana/ui";

const amount = $derived(page.url.searchParams.get("amount") ?? "");
let selectedMethod = $state<"bank_transfer_va" | "qris_redirect">("bank_transfer_va");

function proceed() {
  goto(
    `/campaign/${page.params.slug}/contribute?amount=${amount}&paymentMethod=${selectedMethod}`,
  );
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Pilih Metode Pembayaran</h1>

  <fieldset class="mb-6 space-y-3">
    <label
      class="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-300 p-4"
    >
      <input
        type="radio"
        name="paymentMethod"
        value="bank_transfer_va"
        checked={selectedMethod === "bank_transfer_va"}
        onchange={() => (selectedMethod = "bank_transfer_va")}
      />
      <div>
        <p class="font-sans font-medium text-neutral-900">Transfer Bank (Virtual Account)</p>
        <p class="font-sans text-sm text-neutral-600">Bayar melalui transfer ke nomor VA.</p>
      </div>
    </label>

    <label
      class="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-300 p-4"
    >
      <input
        type="radio"
        name="paymentMethod"
        value="qris_redirect"
        checked={selectedMethod === "qris_redirect"}
        onchange={() => (selectedMethod = "qris_redirect")}
      />
      <div>
        <p class="font-sans font-medium text-neutral-900">QRIS</p>
        <p class="font-sans text-sm text-neutral-600">
          Scan QRIS melalui aplikasi bank atau e-wallet Anda.
        </p>
      </div>
    </label>
  </fieldset>

  <Button onclick={proceed}>Lanjutkan</Button>
</div>
```

- [ ] **Step 2: `contribute/+page.svelte`** — read `paymentMethod` from the query param, send it in the `POST /donations` body, and branch the post-confirm navigation (a `qris_redirect` donation should send the donor straight to Sumopod's hosted payment page, not the internal status page, since that's the actual next real action they need to take — a VA donation still goes to the internal status page since VA payment happens off-platform via the donor's own banking app, with nothing further to navigate to on our side):

```svelte
<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { api } from "$lib/api-client";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const amount = $derived(page.url.searchParams.get("amount") ?? "");
const paymentMethod = $derived(
  (page.url.searchParams.get("paymentMethod") ?? "bank_transfer_va") as
    | "bank_transfer_va"
    | "qris_redirect",
);
let submitting = $state(false);
let error = $state<string | null>(null);

async function confirm() {
  error = null;
  submitting = true;
  const { data: responseData, error: apiError } = await api.donations.post(
    { campaignId: data.campaign.id, amountStr: amount, paymentMethod },
    { headers: { "idempotency-key": crypto.randomUUID() } },
  );
  submitting = false;
  if (apiError || !responseData || "error" in responseData) {
    error = "Gagal memproses donasi. Silakan coba lagi.";
    return;
  }
  if (responseData.method === "qris_redirect" && responseData.redirectUrl) {
    window.location.href = responseData.redirectUrl;
    return;
  }
  await goto(`/donation/status/${responseData.donationId}`);
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

- [ ] **Step 3: Extend both render tests**

`payment-option/page.render.test.ts`: selecting QRIS and clicking Lanjutkan navigates with `paymentMethod=qris_redirect` in the URL; selecting Bank Transfer (or leaving the default) navigates with `paymentMethod=bank_transfer_va`; both preserve the existing `amount` param.

`contribute/page.render.test.ts`: a `bank_transfer_va` submission (mock `fetch` returning `{method: "bank_transfer_va", vaNumber: "...", redirectUrl: null, ...}`) navigates via `goto` to `/donation/status/{id}` as before; a `qris_redirect` submission (mock `fetch` returning `{method: "qris_redirect", redirectUrl: "https://pay.sumopod.com/...", vaNumber: null, ...}`) sets `window.location.href` to the redirect URL instead of calling `goto` — check how this codebase's existing tests handle asserting against `window.location.href` (it may need a `Object.defineProperty(window, "location", ...)` stub, or happy-dom may already support direct assignment tracking; read an existing test elsewhere in this codebase that already tests a `window.location` redirect, if one exists, e.g. any OAuth-related page, before inventing an approach).

- [ ] **Step 4: Run tests, lint, typecheck**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(consumer)/campaign/[slug]/payment-option" "apps/web/src/routes/(consumer)/campaign/[slug]/contribute"
git commit -m "feat(web): add real payment-method selection (Bank Transfer VA vs QRIS)"
```

---

## Task 6: Frontend — donation status page branches on method

**Files:**
- Modify: `apps/web/src/routes/(consumer)/donation/status/[id]/+page.svelte`
- Modify: `apps/web/src/routes/(consumer)/donation/status/[id]/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /donations/:id`'s now-polymorphic response (`method`, `redirectUrl`, nullable `vaNumber`) from Task 4.

- [ ] **Step 1: Update the page to branch on `data.donation.method`**

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="mx-auto max-w-sm py-12">
  {#if data.donation.status === "paid"}
    <h1 class="mb-4 font-sans text-xl font-bold text-green-700">Donasi berhasil! Terima kasih.</h1>
  {:else if data.donation.method === "bank_transfer_va"}
    <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Menunggu pembayaran</h1>
    <p class="mb-2 font-sans text-neutral-700">Transfer ke nomor Virtual Account berikut:</p>
    <p class="mb-4 font-sans text-2xl font-mono font-bold text-neutral-900">{data.donation.vaNumber}</p>
    <p class="font-sans text-sm text-neutral-600">
      Halaman ini belum memperbarui status secara otomatis -- muat ulang setelah transfer untuk
      melihat status terbaru.
    </p>
  {:else}
    <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Menunggu pembayaran</h1>
    <p class="mb-4 font-sans text-neutral-700">
      Pembayaran QRIS Anda belum selesai. Lanjutkan ke halaman pembayaran untuk menyelesaikan.
    </p>
    {#if data.donation.redirectUrl}
      <a
        href={data.donation.redirectUrl}
        class="inline-block rounded-md bg-primary px-4 py-2 font-sans font-semibold text-white"
      >
        Lanjutkan Pembayaran
      </a>
    {/if}
    <p class="mt-4 font-sans text-sm text-neutral-600">
      Halaman ini belum memperbarui status secara otomatis -- muat ulang setelah membayar untuk
      melihat status terbaru.
    </p>
  {/if}
</div>
```

(This still deliberately does NOT poll — matches this codebase's already-established precedent for this exact page, and this plan's own scope doesn't include building async status refresh.)

- [ ] **Step 2: Extend `page.render.test.ts`**

Add cases: a `qris_redirect` + `pending` donation shows the "Lanjutkan Pembayaran" link with the correct `href`; a `qris_redirect` + `paid` donation shows the same success message as a VA donation (the branch is on `status === "paid"` first, method-specific rendering only applies to the pending case — confirm the existing `paid`-status test still passes unchanged, and add an equivalent one with `method: "qris_redirect"` to prove the branch order is right). Existing `bank_transfer_va` tests should need no behavior change, just possibly updated fixture shape (`method`/`redirectUrl` fields added to the mocked `data.donation` object).

- [ ] **Step 3: Run tests, lint, typecheck**

```bash
cd apps/web && bun run test
cd /path/to/repo/root && bun run lint && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/routes/(consumer)/donation/status/[id]"
git commit -m "feat(web): branch donation status page on payment method (VA vs QRIS redirect)"
```

---

## Self-Review Notes (for the controller, not a task)

- **Spec coverage:** every piece of the Sumopod documentation the user pasted is used somewhere in this plan (charge creation, webhook events, both signature-verification schemes are at least acknowledged even though only the HMAC one is implemented). The webhook-URL-configuration step and the real signing secret are explicitly OUT of every task's scope — they're a manual, out-of-band step the controller handles after this plan's code lands, not something any task should attempt or block on.
- **`payment_events.provider` fix**: flagged explicitly in Global Constraints and Task 3/4 — a real latent bug in already-shipped code (Phase 5), fixed as a natural part of adding a second provider rather than a separate unrelated fix, since it only becomes observably wrong once two providers exist.
- **Known follow-up after this plan merges** (not a task, a controller action item): set `SUMOPOD_API_KEY` (from `~/.secrets/sumopod`) and a placeholder/real `SUMOPOD_WEBHOOK_SECRET` in `.env` and `.env.production`; once the webhook URL is configured in Sumopod's dashboard and a real signing secret exists, update `.env.production` and restart the deployed `galangdana-api` service.
