# Phase 4: Help Centre (FAQ + Support) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GalangDana a minimal, self-serve help centre: a public FAQ page backed by admin-authored articles, and a public contact form that lands in an admin queue — the master plan's own "Build minimal — Markdown FAQ + contact form into an admin queue" scope decision, fully implemented.

**Architecture:** One new `apps/api` route file (`routes/help.ts`) holding both the public read/submit endpoints and the admin management endpoints for this feature — topically cohesive, and small enough not to need `admin.ts`'s file split. Two new `packages/db` tables with no foreign-key relationship to the campaign/campaigner subsystem (`help_articles` is fully standalone; `support_tickets` optionally references `users` for a logged-in submitter, nullable). New `apps/web` surface: two public `(consumer)` pages and two new `(admin)` pages, reusing the existing `AdminShell`/`(admin)` layout and its `checkAdmin`-backed auth gate.

**Tech Stack:** SvelteKit 2 (adapter-node), ElysiaJS on Bun, Drizzle + Postgres, TypeBox contracts + Eden Treaty.

**Spec:** `/home/ubuntu/.claude/plans/plan-to-clone-1-1-quiet-snail.md` (master plan — Phase 4's original scope, Module Map, Domain Model) and `docs/superpowers/plans/2026-09-02-phase-3-moderation-verification.md` (the immediately preceding phase — its Global Constraints and established patterns are the most reliable, code-grounded picture of what exists today).

## Scope note — read this before anything else

The master plan's original Phase 4 line groups six things together: "Doa, Aamiin, profiles, streak, missions, FAQ + support," described as having "no payment dependency." That claim does not survive scrutiny: `prayers` (Doa) is defined in the master plan's own domain model with a `donation_id`, and streak/missions/public-profile activity are all inherently derived from donation history. **No real donations exist yet anywhere in this codebase** — Phase 5 (Checkout + Midtrans) has not been built. Building Doa/Aamiin/streak/missions/profiles now would mean either fabricating donation-shaped content behind them, or shipping pages with nothing genuine to show — precisely the "don't publish a page before its data is real" lesson already written up at `docs/research/effortx-recommendations.md` in this repo (from a competitor research pass earlier in this project).

This was raised to the project owner directly, who chose to **split Phase 4**: build only what has zero donation dependency now (this plan), and defer the rest to a new sub-phase inserted right after Phase 5 — mirroring how individual KYC got inserted as Phase 2c between 2a and 2b.

### Explicitly Out of Scope (and why)

- **Doa (prayers) and Aamiin (the "amen" reaction).** `prayers.donation_id` in the master plan's domain model is not nullable in spirit — a Doa is written at the point of donating, in the real product. There is no `donations` table populated anywhere in this codebase yet. Deferred to the post-Phase-5 sub-phase.
- **Streak and missions ("misi-kebaikan") gamification.** Both are inherently computed from a user's donation history (consecutive days donated, donation-count-based challenges). With zero real donations, there is nothing to compute. Deferred alongside Doa/Aamiin.
- **Public donor profile page (`/orang-baik/[id]`).** In the real product this page exists specifically to showcase a donor's giving activity — donation count, prayers, streak/badges. `users.name`/`users.avatarUrl` already exist in this codebase (Phase 0), so a page showing just those two fields with an empty activity section was considered and **rejected as not worth building now**: it has no independent value separate from the donation-linked content it exists to show, and an honestly-empty "activity" section on every single profile is not a meaningful feature — it is the same page this plan should build once donations are real, just prematurely. Deferred alongside Doa/Aamiin/streak/missions, to the same post-Phase-5 sub-phase.
- **Private donor account/settings (`/user`, `/setting/*`).** Never part of Phase 4's scope in the first place — this is explicitly Phase 7's territory ("Donor account") per the master plan's own phase ordering.
- **Outbound notifications for support tickets** (e.g. "we received your message" email, "your ticket was resolved" notification). The master plan is explicit: "Notifications (inbox, email, web push, WhatsApp via kirim.dev) land incrementally from Phase 5, when the first receipt needs sending." This plan captures a submitter's name/email so an admin can manually follow up, but sends nothing itself.
- **A separate per-article detail page (`/help/[slug]`).** Kitabisa's own module map lists only `/help` as a public route — no per-article URL. A single FAQ list page (accordion-style, all articles inline) fully covers "Build minimal."
- **Draft/unpublished FAQ article states.** Every article an admin creates is immediately public — no draft workflow, no scheduling. Matches "Build minimal."

## Global Constraints

- **Money is bigint minor-unit rupiah, never float** (repo-wide constraint since Phase 0a). Not applicable to this plan directly — no money value is read, written, or displayed anywhere in this feature — but stated here because it is a standing project-wide rule.
- **Only one authorization model is needed in this plan (unlike Phase 3, which had two).** Every admin endpoint (`/admin/help-articles/*`, `/admin/support-tickets/*`) is role-scoped via the existing `checkAdmin(user)` helper (`apps/api/src/lib/admin.ts`, unchanged, imported as-is) — 401 if unauthenticated, 403 if authenticated but not an admin. There is no ownership-scoped surface in this plan: FAQ articles have no owner (any admin can edit any article), and a support ticket's optional `userId` is informational only, never used to scope a query (a submitter cannot view or list "their" tickets in this plan — that's a future addition, not required by "Build minimal").
- **The public `POST /support-tickets` endpoint does NOT require authentication.** It uses the existing `sessionDerive` plugin (`apps/api/src/lib/session.ts`), which never rejects — `user` is `null` when there is no session, non-null otherwise. When `user` is present, its `id` is stored as `support_tickets.userId`; when absent, `support_tickets.userId` is left `null`. Do not add an auth guard to this endpoint.
- **A single shared error schema for this whole plan.** Phase 3's final review found and fixed a real mistake: `CampaignErrorSchema2c` was a needless duplicate of the pre-existing `CampaignErrorSchema`, defined because a new phase didn't reuse what already existed. Do not repeat that here. Define exactly ONE `HelpErrorSchema = Type.Object({ error: Type.String() })` in `packages/contracts/src/help.ts` (Task 2) and reuse it for every error response in this plan. Where an action's success response is a bare status string (resolve a ticket, delete an article), reuse the EXISTING `AdminActionResponseSchema` from `@galangdana/contracts` (already defined in `campaigns.ts`, already exported) rather than defining a new one.
- **Eden Treaty kebab-case bracket-notation gotcha, established since Phase 2a/2c/3:** both new top-level route segments in this plan — `/help-articles` and `/support-tickets` — contain a hyphen. Every Eden Treaty client call against them MUST use bracket notation: `api["help-articles"].get(...)`, `api["support-tickets"].post(...)`, `client.admin["help-articles"].post(...)`, `client.admin["help-articles"]({ id }).put(...)`, `client.admin["support-tickets"]({ id }).resolve.post(...)`. Plain dot notation (`api.helpArticles`) will not compile — Eden's generated client keys are the literal route segments, not camelCased.
- **Eden Treaty TYPE-level route-merging conflict — assessed as not applicable in this plan, but verify empirically anyway.** This bug class (established in Phase 2c/3) only triggers when two DIFFERENT routes share the exact same path depth with a param at the same position but a DIFFERENT param name. Every dynamic route this plan adds (`/admin/help-articles/:id`, `/admin/support-tickets/:id/resolve`) has a distinct, unique literal segment (`help-articles`, `support-tickets`) immediately before its own `:id` — there is no existing route anywhere in this codebase sharing that exact literal prefix. This plan is not expected to hit the collision. If `bun run typecheck` DOES surface a merged-intersection error on a frontend call in this plan anyway, that assessment was wrong — stop, do not guess a workaround, escalate it as a real plan defect for the controller to rule on.
- **Eden Treaty response-type over-narrowing, established since Phase 3:** `support_tickets.status` is a Postgres enum (`open`/`resolved`) surfaced through a `Type.Union([Type.Literal("open"), Type.Literal("resolved")])` contract field. If a frontend `+page.server.ts` load's `bun run typecheck` reports an over-narrowing error on this field (or on `help_articles`/`support_tickets` fields generally), apply the SAME two-part cast fix used repeatedly in Phase 3 (most recently `apps/web/src/routes/(admin)/dashboard/+page.server.ts`): cast the base callable `as any`, then re-cast the AWAITED RESULT to Eden's real `Treaty.TreatyResponse<{200: ..., 401: ..., 403: ...}>` type matching the endpoint's actual response map. Never leave the cast on just the callable.
- **Atomic status-transition guard, established in Phase 3's final review fix wave.** `POST /admin/support-tickets/:id/resolve` must guard its `open -> resolved` transition the same way Phase 3's `approve`/`request-revision` do: the UPDATE's own `WHERE` clause includes `AND status = 'open'`, and a `.returning()` array of length 0 means 409 (already resolved, or a genuine race with a second admin) — not a separate read-then-check that leaves a race window.
- **`apps/web` test-file gotchas, established across Phase 2a/2c/3:**
  - Any test file whose component (transitively) imports `$lib/api-client` needs `vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }))` at the top.
  - Any test exercising a component that calls `goto(...)` needs `vi.mock("$app/navigation", () => ({ goto: (...args) => goto(...args) }))` with a `vi.fn()`-backed `goto`.
  - A `render(Page, { props: { data, params, ... } })` call needs a real `params` object matching the route's dynamic segments, and `form: null` if the generated `PageProps` type requires it (check the route's own `.svelte-kit/types/.../$types.d.ts` if unsure — some routes require it, some don't, depending on whether SvelteKit generates an `ActionData` for that route).
- **The authenticated cross-origin SSR pattern** (`createServerApiClient` from `apps/web/src/lib/server-api-client.ts`, `+page.server.ts` reading `event.cookies`) applies to the two new `(admin)` pages in this plan. The two new `(consumer)` pages do NOT need it — they call the public, unauthenticated endpoints via the plain `api` client from `$lib/api-client` (a universal `+page.ts`/client-side call), matching `(consumer)/search/+page.ts`'s existing pattern.
- **`bun run lint` clean before every commit** — non-negotiable, repeated in every phase of this project.
- **This repo is 100% Bun tooling. Never npm/yarn/npx.**
- **`bun` may not be on PATH in a fresh shell**, especially inside an isolated git worktree. It is installed at `/home/ubuntu/.bun/bin/bun` (v1.4.0). Either `export PATH="/home/ubuntu/.bun/bin:$PATH"` first, or invoke via the full path.
- **`apps/api` tests need `--env-file=../../.env`** (a bare `cd apps/api && bun test` misses the repo root `.env` and causes unrelated search/imgproxy test failures). A freshly created worktree also needs the repo root `.env` FILE COPIED IN MANUALLY — it is untracked/gitignored and does not carry over automatically. This worktree already has it copied in and its baseline verified — no task needs to redo this.
- **Repo-wide `bun run typecheck` (from the worktree root), never package-scoped only, for every task.** A documented Phase 2c incident (Task 6) shows a package-scoped-only typecheck missing a real cross-package Eden Treaty regression that the repo-wide command catches immediately.
- **Three pre-existing, unrelated `apps/api` test failures exist in this worktree's baseline**, verified before this plan was written: `GET /campaigns > sort=newest orders by publishedAt descending`, `GET /campaigns > sort=urgent orders...`, and `GET /campaigns > cover image URLs are real...`. These are environmental (missing `IMGPROXY_KEY`/`IMGPROXY_SALT` in this sandbox, and shared dev-DB test-data accumulation) and have nothing to do with this plan's files. Do not attempt to fix them; do not treat their presence as a regression.
- **No new dependency on `notifications_outbox`.** It does not exist yet. Do not reference it, import it, or design around it landing mid-plan.

## Domain Model / Interfaces Summary

New tables (both in `packages/db/src/schema/`, both added to the `schema/index.ts` barrel):
- `help_articles` (new): `id (uuid, pk)`, `slug (text, unique, not null)`, `question (text, not null)`, `answer (text, not null — Markdown source, rendered client-side)`, `createdAt`, `updatedAt`.
- `support_tickets` (new): `id (uuid, pk)`, `userId (uuid, nullable, FK -> users.id, onDelete: set null)`, `name (text, not null)`, `email (text, not null)`, `message (text, not null)`, `status (enum: open | resolved, not null, default open)`, `createdAt`, `resolvedAt (nullable)`.

New API surface (`apps/api/src/routes/help.ts`, new file, mounted in `apps/api/src/index.ts`):
- `GET /help-articles` — public, no auth. Lists all FAQ articles.
- `POST /support-tickets` — public, no auth required (optionally attaches `userId` if the caller has a session). Creates a support ticket.
- `POST /admin/help-articles` — checkAdmin-gated. Creates an article.
- `PUT /admin/help-articles/:id` — checkAdmin-gated. Updates an article's question/answer (slug is immutable after creation).
- `DELETE /admin/help-articles/:id` — checkAdmin-gated. Deletes an article.
- `GET /admin/support-tickets?status=open` — checkAdmin-gated. Lists tickets, defaulting to `open`.
- `POST /admin/support-tickets/:id/resolve` — checkAdmin-gated. `open -> resolved`, atomically guarded.

New web surface:
- `apps/web/src/routes/(consumer)/help/+page.ts` + `+page.svelte` (new) — the public FAQ list.
- `apps/web/src/routes/(consumer)/contact/+page.svelte` (new) — the public contact form.
- `apps/web/src/routes/(admin)/help-articles/+page.server.ts` + `+page.svelte` (new) — admin FAQ management: list, create, edit, delete.
- `apps/web/src/routes/(admin)/support-tickets/+page.server.ts` + `+page.svelte` (new) — admin ticket queue: list, resolve.

---

### Task 1: Schema — `help_articles` and `support_tickets`

**Files:**
- Create: `packages/db/src/schema/help-articles.ts`
- Create: `packages/db/src/schema/support-tickets.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/__tests__/help-articles.test.ts`
- Create: `packages/db/src/__tests__/support-tickets.test.ts`

**Interfaces:**
- Consumes: `users` (existing, for `support_tickets.userId`'s FK).
- Produces: `helpArticles` table, `supportTickets` table, `supportTicketStatusEnum` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Write the failing tests**

`packages/db/src/__tests__/help-articles.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { helpArticles } from "../schema/help-articles";

describe("help_articles", () => {
  beforeAll(async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "test-cara-berdonasi"));
  });

  test("an article can be created with a unique slug", async () => {
    const [article] = await db
      .insert(helpArticles)
      .values({
        slug: "test-cara-berdonasi",
        question: "Bagaimana cara berdonasi?",
        answer: "Pilih campaign, tentukan nominal, lalu pilih metode pembayaran.",
      })
      .returning();
    expect(article?.question).toBe("Bagaimana cara berdonasi?");
    expect(article?.createdAt).toBeInstanceOf(Date);
  });

  test("slug must be unique across articles", async () => {
    await db.insert(helpArticles).values({
      slug: "test-cara-berdonasi",
      question: "Q1",
      answer: "A1",
    });
    await expect(
      Promise.resolve(
        db.insert(helpArticles).values({
          slug: "test-cara-berdonasi",
          question: "Q2",
          answer: "A2",
        }),
      ),
    ).rejects.toThrow(/unique/i);
  });
});
```

`packages/db/src/__tests__/support-tickets.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { supportTickets } from "../schema/support-tickets";
import { users } from "../schema/users";

const TEST_PHONE = "+6281199100001";

describe("support_tickets", () => {
  beforeAll(async () => {
    await db.delete(users).where(inArray(users.phone, [TEST_PHONE]));
  });

  test("a ticket can be created without a user (guest submission)", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({ name: "Budi", email: "budi@example.test", message: "Donasi saya tidak tercatat." })
      .returning();
    expect(ticket?.userId).toBeNull();
    expect(ticket?.status).toBe("open");
    expect(ticket?.resolvedAt).toBeNull();
  });

  test("a ticket can be created with a user attached", async () => {
    const [user] = await db.insert(users).values({ phone: TEST_PHONE }).returning();
    if (!user) throw new Error("user insert failed");
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        userId: user.id,
        name: "Siti",
        email: "siti@example.test",
        message: "Bagaimana cara mengubah nomor rekening?",
      })
      .returning();
    expect(ticket?.userId).toBe(user.id);
  });

  test("deleting the attached user sets userId to null, not deleting the ticket", async () => {
    const [user] = await db
      .insert(users)
      .values({ phone: "+6281199100002" })
      .returning();
    if (!user) throw new Error("user insert failed");
    const [ticket] = await db
      .insert(supportTickets)
      .values({ userId: user.id, name: "Dedi", email: "dedi@example.test", message: "Halo." })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    await db.delete(users).where(eq(users.id, user.id));

    const [remaining] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticket.id));
    expect(remaining?.userId).toBeNull();
    expect(remaining?.name).toBe("Dedi");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/db && bun test src/__tests__/help-articles.test.ts src/__tests__/support-tickets.test.ts --env-file=../../.env`
Expected: FAIL — the modules don't exist yet.

- [ ] **Step 3: Implement — `packages/db/src/schema/help-articles.ts`**

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Every article is public and live immediately on creation -- no draft or
// scheduling state, matching the master plan's "Build minimal" scope
// decision for the help centre. `answer` holds Markdown source, rendered
// client-side by the FAQ page; there is no separate rendered-HTML column.
export const helpArticles = pgTable("help_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HelpArticle = typeof helpArticles.$inferSelect;
export type NewHelpArticle = typeof helpArticles.$inferInsert;
```

- [ ] **Step 4: Implement — `packages/db/src/schema/support-tickets.ts`**

```ts
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const supportTicketStatusEnum = pgEnum("support_ticket_status", ["open", "resolved"]);

// userId is nullable and onDelete: "set null" -- a support ticket is a
// standalone record of a contact-form submission, not owned data that
// should disappear if the submitter's account is later deleted. `name`
// and `email` are captured directly on the ticket (not read from `users`)
// because submission never requires authentication -- a guest with no
// account at all is the common case, not the exception.
export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  status: supportTicketStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
```

- [ ] **Step 5: Add both to the schema barrel — `packages/db/src/schema/index.ts`**

Add two lines at the end of the existing file:

```ts
export * from "./help-articles";
export * from "./support-tickets";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/db && bun test src/__tests__/help-articles.test.ts src/__tests__/support-tickets.test.ts --env-file=../../.env`
Expected: PASS.

- [ ] **Step 7: Generate and apply the migration**

Run: `cd packages/db && bun run db:generate` — produces a new migration file plus the usual auto-generated `meta/*_snapshot.json`/`meta/_journal.json` updates (don't hand-edit the generated SQL). Then: `cd packages/db && bun run db:migrate`.

- [ ] **Step 8: Run the full `packages/db` suite, lint, typecheck**

Run: `cd packages/db && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): add help_articles and support_tickets tables"
```

---

### Task 2: Contracts — `packages/contracts/src/help.ts`

**Files:**
- Create: `packages/contracts/src/help.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `AdminActionResponseSchema` (existing, from `./campaigns`, re-exported as-is — do not redefine it).
- Produces: `HelpErrorSchema`, `HelpArticleSchema`, `HelpArticleListResponseSchema`, `CreateHelpArticleBodySchema`, `UpdateHelpArticleBodySchema`, `SubmitSupportTicketBodySchema`, `SubmitSupportTicketResponseSchema`, `SupportTicketSchema`, `AdminSupportTicketListResponseSchema` — consumed by Tasks 3, 4, and every frontend task.

There is no failing-test step for this task — TypeBox schema definitions have no runtime behavior of their own to test; their correctness is proven by the API tasks that use them to validate real requests (Tasks 3-4) and by `bun run typecheck` succeeding end to end.

- [ ] **Step 1: Create `packages/contracts/src/help.ts`**

```ts
import { type Static, Type } from "@sinclair/typebox";

export const HelpErrorSchema = Type.Object({ error: Type.String() });

export const HelpArticleSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  slug: Type.String(),
  question: Type.String(),
  answer: Type.String(),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
});
export type HelpArticleResponse = Static<typeof HelpArticleSchema>;

export const HelpArticleListResponseSchema = Type.Object({
  articles: Type.Array(HelpArticleSchema),
});
export type HelpArticleListResponse = Static<typeof HelpArticleListResponseSchema>;

// Slugs are lowercase-kebab-case and immutable after creation (see this
// plan's "Explicitly Out of Scope" notes -- no draft/rename workflow).
export const CreateHelpArticleBodySchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-z0-9-]+$" }),
  question: Type.String({ minLength: 1, maxLength: 300 }),
  answer: Type.String({ minLength: 1, maxLength: 10000 }),
});

export const UpdateHelpArticleBodySchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 300 }),
  answer: Type.String({ minLength: 1, maxLength: 10000 }),
});

export const SubmitSupportTicketBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.String({ format: "email" }),
  message: Type.String({ minLength: 1, maxLength: 5000 }),
});

export const SubmitSupportTicketResponseSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
});
export type SubmitSupportTicketResponse = Static<typeof SubmitSupportTicketResponseSchema>;

export const SupportTicketStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("resolved"),
]);

export const SupportTicketSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  email: Type.String(),
  message: Type.String(),
  status: SupportTicketStatusSchema,
  createdAt: Type.String({ format: "date-time" }),
  resolvedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

export const AdminSupportTicketListResponseSchema = Type.Object({
  tickets: Type.Array(SupportTicketSchema),
});
export type AdminSupportTicketListResponse = Static<typeof AdminSupportTicketListResponseSchema>;
```

- [ ] **Step 2: Export from `packages/contracts/src/index.ts`**

Add at the end of the file, matching the existing per-module export-block style:

```ts
export {
  AdminSupportTicketListResponseSchema,
  CreateHelpArticleBodySchema,
  HelpArticleListResponseSchema,
  HelpArticleSchema,
  HelpErrorSchema,
  SubmitSupportTicketBodySchema,
  SubmitSupportTicketResponseSchema,
  SupportTicketSchema,
  SupportTicketStatusSchema,
  UpdateHelpArticleBodySchema,
} from "./help";
export type {
  AdminSupportTicketListResponse,
  HelpArticleListResponse,
  HelpArticleResponse,
  SubmitSupportTicketResponse,
} from "./help";
```

- [ ] **Step 3: Run lint and typecheck**

Run: `cd packages/contracts && bun test && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean (there's no existing `packages/contracts` test suite exercising these new schemas directly — the repo's existing `packages/contracts` tests, if any, must still pass unmodified).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add help centre schemas"
```

---

### Task 3: API — public endpoints (`GET /help-articles`, `POST /support-tickets`)

**Files:**
- Create: `apps/api/src/routes/help.ts`
- Create: `apps/api/src/routes/help.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `helpArticles`, `supportTickets` (Task 1); `HelpArticleListResponseSchema`, `SubmitSupportTicketBodySchema`, `SubmitSupportTicketResponseSchema`, `HelpErrorSchema` (Task 2); `sessionDerive` (existing, `apps/api/src/lib/session.ts`).
- Produces: the `helpRoute` Elysia plugin, mounted into `app` — consumed by Task 4 (which extends the same file) and every frontend task.

- [ ] **Step 1: Write the failing tests — `apps/api/src/routes/help.test.ts`**

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { db, helpArticles, sessions, supportTickets, users } from "@galangdana/db";
import { eq, inArray } from "drizzle-orm";
import { helpRoute } from "./help";

const app = helpRoute;

const USER_ID = "44444444-5555-6666-7777-888888888901";
const TOKEN = "help-test-user-token";

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `session=${token}` } });
}

beforeAll(async () => {
  await db.delete(users).where(inArray(users.id, [USER_ID]));
  await db.insert(users).values({ id: USER_ID, phone: "+6281199200001" });
  await db.insert(sessions).values({ id: TOKEN, userId: USER_ID, expiresAt: new Date(Date.now() + 86400000) });
  await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-article"));
});

describe("GET /help-articles", () => {
  test("lists articles, publicly, no auth required", async () => {
    await db.insert(helpArticles).values({
      slug: "help-test-article",
      question: "Apakah donasi saya aman?",
      answer: "Ya, semua transaksi diproses melalui payment gateway resmi.",
    });
    const resp = await app.handle(new Request("http://localhost/help-articles"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { articles: Array<{ slug: string }> };
    expect(body.articles.some((a) => a.slug === "help-test-article")).toBe(true);
  });
});

describe("POST /support-tickets", () => {
  test("creates a ticket without authentication", async () => {
    const resp = await app.handle(
      new Request("http://localhost/support-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Rina",
          email: "rina@example.test",
          message: "Bagaimana cara membatalkan donasi berulang?",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string };
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, body.id));
    expect(row?.userId).toBeNull();
    expect(row?.status).toBe("open");
  });

  test("attaches the caller's userId when authenticated", async () => {
    const resp = await app.handle(
      authedRequest("http://localhost/support-tickets", TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test User",
          email: "test-user@example.test",
          message: "Saya butuh bantuan mengubah email akun.",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string };
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, body.id));
    expect(row?.userId).toBe(USER_ID);
  });

  test("422s on an invalid email", async () => {
    const resp = await app.handle(
      new Request("http://localhost/support-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", email: "not-an-email", message: "Halo." }),
      }),
    );
    expect(resp.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/help.test.ts --env-file=../../.env`
Expected: FAIL — `./help` doesn't exist yet.

- [ ] **Step 3: Implement — `apps/api/src/routes/help.ts`**

```ts
import { HelpArticleListResponseSchema, SubmitSupportTicketBodySchema, SubmitSupportTicketResponseSchema } from "@galangdana/contracts";
import { db, helpArticles, supportTickets } from "@galangdana/db";
import { desc } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { sessionDerive } from "../lib/session";

export const helpRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/help-articles",
    async () => {
      const rows = await db.select().from(helpArticles).orderBy(desc(helpArticles.createdAt));
      return {
        articles: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          question: row.question,
          answer: row.answer,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    },
    {
      response: { 200: HelpArticleListResponseSchema },
    },
  )
  .post(
    "/support-tickets",
    async ({ user, body }) => {
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          userId: user?.id,
          name: body.name,
          email: body.email,
          message: body.message,
        })
        .returning();
      if (!ticket) throw new Error("support ticket insert returned no row");
      return { id: ticket.id };
    },
    {
      body: SubmitSupportTicketBodySchema,
      response: { 200: SubmitSupportTicketResponseSchema },
    },
  );
```

- [ ] **Step 4: Mount the route — `apps/api/src/index.ts`**

Add the import alongside the existing route imports:

```ts
import { helpRoute } from "./routes/help";
```

Add `.use(helpRoute)` to the chain, after `.use(adminRoute)`:

```ts
  .use(adminRoute)
  .use(helpRoute);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/help.test.ts --env-file=../../.env`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: clean except the 3 documented pre-existing failures (see Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add public help-articles list and support-ticket submission"
```

---

### Task 4: API — admin endpoints (extending `apps/api/src/routes/help.ts`)

**Files:**
- Modify: `apps/api/src/routes/help.ts`
- Modify: `apps/api/src/routes/help.test.ts`

**Interfaces:**
- Consumes: `checkAdmin` (existing, `apps/api/src/lib/admin.ts`); `AdminActionResponseSchema` (existing, `@galangdana/contracts`); `CreateHelpArticleBodySchema`, `UpdateHelpArticleBodySchema`, `AdminSupportTicketListResponseSchema`, `HelpErrorSchema` (Task 2).
- Produces: the full admin CRUD surface for this feature — consumed by Tasks 7 and 8 (frontend admin pages).

No separate `GET /admin/help-articles` is added: article content is fully public with no confidentiality concern (unlike campaign moderation data, which includes KYC PII), so the admin FAQ management page reuses the same `GET /help-articles` from Task 3 for its list — only the mutations (create/update/delete) need the admin gate.

- [ ] **Step 1: Write the failing tests — append to `apps/api/src/routes/help.test.ts`**

```ts
import { supportTicketStatusEnum } from "@galangdana/db"; // add to the existing top-of-file import from "@galangdana/db" instead if that's cleaner -- see note below

const ADMIN_USER_ID = "44444444-5555-6666-7777-888888888902";
const ADMIN_TOKEN = "help-test-admin-token";

// Add this to the existing beforeAll (do not duplicate a second beforeAll block):
//   await db.delete(users).where(inArray(users.id, [USER_ID, ADMIN_USER_ID]));
//   await db.insert(users).values([
//     { id: USER_ID, phone: "+6281199200001" },
//     { id: ADMIN_USER_ID, phone: "+6281199200002", role: "admin" },
//   ]);
//   await db.insert(sessions).values([
//     { id: TOKEN, userId: USER_ID, expiresAt: new Date(Date.now() + 86400000) },
//     { id: ADMIN_TOKEN, userId: ADMIN_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
//   ]);

describe("POST /admin/help-articles", () => {
  test("401s for an unauthenticated request", async () => {
    const resp = await app.handle(
      new Request("http://localhost/admin/help-articles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "x", question: "Q", answer: "A" }),
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const resp = await app.handle(
      authedRequest("http://localhost/admin/help-articles", TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "x", question: "Q", answer: "A" }),
      }),
    );
    expect(resp.status).toBe(403);
  });

  test("creates an article for an admin", async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-admin-create"));
    const resp = await app.handle(
      authedRequest("http://localhost/admin/help-articles", ADMIN_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "help-test-admin-create",
          question: "Bagaimana cara menghubungi tim?",
          answer: "Gunakan formulir kontak.",
        }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; slug: string };
    expect(body.slug).toBe("help-test-admin-create");
  });
});

describe("PUT /admin/help-articles/:id", () => {
  test("updates question and answer", async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-admin-update"));
    const [article] = await db
      .insert(helpArticles)
      .values({ slug: "help-test-admin-update", question: "Q1", answer: "A1" })
      .returning();
    if (!article) throw new Error("article insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/help-articles/${article.id}`, ADMIN_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Q1 diperbarui", answer: "A1 diperbarui" }),
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(helpArticles).where(eq(helpArticles.id, article.id));
    expect(row?.question).toBe("Q1 diperbarui");
  });
});

describe("DELETE /admin/help-articles/:id", () => {
  test("deletes an article", async () => {
    await db.delete(helpArticles).where(eq(helpArticles.slug, "help-test-admin-delete"));
    const [article] = await db
      .insert(helpArticles)
      .values({ slug: "help-test-admin-delete", question: "Q", answer: "A" })
      .returning();
    if (!article) throw new Error("article insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/help-articles/${article.id}`, ADMIN_TOKEN, {
        method: "DELETE",
      }),
    );
    expect(resp.status).toBe(200);
    const remaining = await db.select().from(helpArticles).where(eq(helpArticles.id, article.id));
    expect(remaining).toHaveLength(0);
  });
});

describe("GET /admin/support-tickets", () => {
  test("401s for an unauthenticated request", async () => {
    const resp = await app.handle(new Request("http://localhost/admin/support-tickets"));
    expect(resp.status).toBe(401);
  });

  test("lists open tickets by default, for an admin", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({ name: "Queue Test", email: "queue@example.test", message: "Test message." })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    const resp = await app.handle(
      authedRequest("http://localhost/admin/support-tickets", ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { tickets: Array<{ id: string; status: string }> };
    expect(body.tickets.some((t) => t.id === ticket.id && t.status === "open")).toBe(true);
  });
});

describe("POST /admin/support-tickets/:id/resolve", () => {
  test("resolves an open ticket", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({ name: "Resolve Test", email: "resolve@example.test", message: "Test." })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/support-tickets/${ticket.id}/resolve`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id));
    expect(row?.status).toBe("resolved");
    expect(row?.resolvedAt).not.toBeNull();
  });

  test("409s on an already-resolved ticket", async () => {
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        name: "Already Resolved",
        email: "already@example.test",
        message: "Test.",
        status: "resolved",
        resolvedAt: new Date(),
      })
      .returning();
    if (!ticket) throw new Error("ticket insert failed");

    const resp = await app.handle(
      authedRequest(`http://localhost/admin/support-tickets/${ticket.id}/resolve`, ADMIN_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
  });
});
```

(Note on the import list: the test file's existing `import { db, helpArticles, sessions, supportTickets, users } from "@galangdana/db";` line from Task 3 already covers everything needed here — do not add a second, separate `supportTicketStatusEnum` import unless a step actually uses it; the sketch above only needed it for one seed value, which is written as the literal string `"resolved"` instead. Merge the two `ADMIN_USER_ID`/`ADMIN_TOKEN` seed inserts into the file's single existing `beforeAll` block, not a second one — Bun's test runner does not guarantee two `beforeAll` blocks in one file run in a particular order relative to each other's setup being visible to all tests.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && bun test src/routes/help.test.ts --env-file=../../.env`
Expected: FAIL — the admin endpoints don't exist yet.

- [ ] **Step 3: Implement — extend `apps/api/src/routes/help.ts`**

Add these imports to the top of the file (merge with the existing import lines, don't duplicate):

```ts
import {
  AdminActionResponseSchema,
  AdminSupportTicketListResponseSchema,
  CreateHelpArticleBodySchema,
  HelpArticleListResponseSchema,
  HelpArticleSchema,
  HelpErrorSchema,
  SubmitSupportTicketBodySchema,
  SubmitSupportTicketResponseSchema,
  UpdateHelpArticleBodySchema,
} from "@galangdana/contracts";
import { db, helpArticles, supportTickets, type supportTicketStatusEnum } from "@galangdana/db";
import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { checkAdmin } from "../lib/admin";
import { sessionDerive } from "../lib/session";
```

Append these five handlers to the existing `helpRoute` chain (after the `POST /support-tickets` handler, before the final `;`):

```ts
  .post(
    "/admin/help-articles",
    async ({ user, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const [article] = await db.insert(helpArticles).values(body).returning();
      if (!article) throw new Error("help article insert returned no row");
      return {
        id: article.id,
        slug: article.slug,
        question: article.question,
        answer: article.answer,
        createdAt: article.createdAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
      };
    },
    {
      body: CreateHelpArticleBodySchema,
      response: { 200: HelpArticleSchema, 401: HelpErrorSchema, 403: HelpErrorSchema },
    },
  )
  .put(
    "/admin/help-articles/:id",
    async ({ user, params, body, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const [article] = await db
        .update(helpArticles)
        .set({ question: body.question, answer: body.answer, updatedAt: new Date() })
        .where(eq(helpArticles.id, params.id))
        .returning();
      if (!article) {
        set.status = 404;
        return { error: "article_not_found" };
      }
      return {
        id: article.id,
        slug: article.slug,
        question: article.question,
        answer: article.answer,
        createdAt: article.createdAt.toISOString(),
        updatedAt: article.updatedAt.toISOString(),
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: UpdateHelpArticleBodySchema,
      response: {
        200: HelpArticleSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
        404: HelpErrorSchema,
      },
    },
  )
  .delete(
    "/admin/help-articles/:id",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const deleted = await db
        .delete(helpArticles)
        .where(eq(helpArticles.id, params.id))
        .returning();
      if (deleted.length === 0) {
        set.status = 404;
        return { error: "article_not_found" };
      }
      return { status: "deleted" };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AdminActionResponseSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
        404: HelpErrorSchema,
      },
    },
  )
  .get(
    "/admin/support-tickets",
    async ({ user, query, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      // Same documented tradeoff as GET /admin/campaigns (apps/api/src/routes/admin.ts):
      // query.status is validated only as a generic string by this route's `t.Object`
      // schema below, but the column is a Postgres enum -- an unrecognized value does
      // NOT match zero rows, it throws. Acceptable here for the same reason: this route
      // is checkAdmin-gated and no caller in this plan sends an arbitrary value.
      const status = (query.status ??
        "open") as (typeof supportTicketStatusEnum.enumValues)[number];
      const rows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.status, status))
        .orderBy(desc(supportTickets.createdAt));
      return {
        tickets: rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          message: row.message,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
        })),
      };
    },
    {
      query: t.Object({ status: t.Optional(t.String()) }),
      response: {
        200: AdminSupportTicketListResponseSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
      },
    },
  )
  .post(
    "/admin/support-tickets/:id/resolve",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const updated = await db
        .update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(and(eq(supportTickets.id, params.id), eq(supportTickets.status, "open")))
        .returning();
      if (updated.length === 0) {
        set.status = 409;
        return { error: "invalid_ticket_status" };
      }
      return { status: "resolved" };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: AdminActionResponseSchema,
        401: HelpErrorSchema,
        403: HelpErrorSchema,
        409: HelpErrorSchema,
      },
    },
  );
```

(`PUT /admin/help-articles/:id` returns a plain 404 rather than distinguishing "not found" from an invalid id format — matching this codebase's established, accepted tradeoff on every other `t.Object({ id: t.String() })` param without `format: "uuid"`, e.g. `apps/api/src/routes/admin.ts`'s campaign-id params. Not something to fix in this task.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && bun test src/routes/help.test.ts --env-file=../../.env`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/api` suite, lint, typecheck**

Run: `cd apps/api && bun test --env-file=../../.env && cd <worktree root> && bun run lint && bun run typecheck`
Expected: clean except the 3 documented pre-existing failures.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add admin help-article CRUD and support-ticket queue"
```

---

### Task 5: Frontend — public FAQ page (`/help`)

**Files:**
- Create: `apps/web/src/routes/(consumer)/help/+page.ts`
- Create: `apps/web/src/routes/(consumer)/help/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/help/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /help-articles` (Task 3), the plain `api` client (`$lib/api-client`, existing).
- Produces: nothing consumed by a later task — this is a leaf page.

- [ ] **Step 1: Write the failing test — `page.render.test.ts`**

```ts
// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_ARTICLES = [
  {
    id: "1",
    slug: "cara-berdonasi",
    question: "Bagaimana cara berdonasi?",
    answer: "Pilih campaign, tentukan nominal, lalu pilih metode pembayaran.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

describe("(consumer) /help rendering", () => {
  test("with no articles, shows an empty state", () => {
    render(Page, { props: { params: {}, data: { articles: [] } } });
    expect(screen.getByText(/Belum ada pertanyaan/)).not.toBeNull();
  });

  test("with articles, shows each question and answer", () => {
    render(Page, { props: { params: {}, data: { articles: SAMPLE_ARTICLES } } });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();
    expect(
      screen.getByText("Pilih campaign, tentukan nominal, lalu pilih metode pembayaran."),
    ).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/help/page.render.test.ts"`
Expected: FAIL — `./+page.svelte` doesn't exist.

- [ ] **Step 3: Implement — `+page.ts`**

```ts
import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  try {
    const { data, error: apiError } = await api["help-articles"].get();
    if (apiError || !data) {
      console.error("GET /help-articles failed while loading the help page:", apiError ?? data);
      return { articles: [] };
    }
    return { articles: data.articles };
  } catch (err) {
    console.error("GET /help-articles threw while loading the help page:", err);
    return { articles: [] };
  }
};
```

- [ ] **Step 4: Implement — `+page.svelte`**

```svelte
<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="mx-auto max-w-2xl px-4 py-12">
  <h1 class="mb-6 font-sans text-2xl font-bold text-neutral-900">Pusat Bantuan</h1>

  {#if data.articles.length === 0}
    <p class="font-sans text-neutral-600">Belum ada pertanyaan yang tersedia saat ini.</p>
  {:else}
    <div class="space-y-6">
      {#each data.articles as article (article.id)}
        <div class="border-b border-neutral-200 pb-6">
          <h2 class="mb-2 font-sans text-lg font-semibold text-neutral-900">{article.question}</h2>
          <p class="whitespace-pre-wrap font-sans text-neutral-700">{article.answer}</p>
        </div>
      {/each}
    </div>
  {/if}

  <p class="mt-10 font-sans text-neutral-600">
    Tidak menemukan jawaban? <a href="/contact" class="text-primary hover:underline">Hubungi kami</a>.
  </p>
</div>
```

(`answer` is rendered as plain pre-wrapped text, not parsed as Markdown-to-HTML — this codebase has no Markdown renderer dependency anywhere yet, and adding one is out of scope for "Build minimal." The schema documents `answer` as Markdown *source* for a future rendering upgrade; today it displays as-authored, which is legible for the short informational answers this feature holds.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/help/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add public FAQ page"
```

---

### Task 6: Frontend — public contact form (`/contact`)

**Files:**
- Create: `apps/web/src/routes/(consumer)/contact/+page.svelte`
- Create: `apps/web/src/routes/(consumer)/contact/page.render.test.ts`

**Interfaces:**
- Consumes: `POST /support-tickets` (Task 3), the plain `api` client (`$lib/api-client`, existing).
- Produces: nothing consumed by a later task — this is a leaf page.

This page needs no `+page.ts`/`+page.server.ts` — like `/login`, it's a pure client-side form with no data to load, only an action to submit.

- [ ] **Step 1: Write the failing test — `page.render.test.ts`**

```ts
// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) /contact rendering", () => {
  test("shows the contact form", () => {
    render(Page, { props: { params: {}, data: {} } });
    expect(screen.getByLabelText("Nama")).not.toBeNull();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByLabelText("Pesan")).not.toBeNull();
  });

  test("submits the form and shows a confirmation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "11111111-1111-1111-1111-111111111111" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, data: {} } });
    await fireEvent.input(screen.getByLabelText("Nama"), { target: { value: "Rina" } });
    await fireEvent.input(screen.getByLabelText("Email"), { target: { value: "rina@example.test" } });
    await fireEvent.input(screen.getByLabelText("Pesan"), {
      target: { value: "Saya butuh bantuan." },
    });
    await fireEvent.click(screen.getByText("Kirim"));

    await waitFor(() => {
      expect(screen.getByText(/Pesan Anda telah terkirim/)).not.toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/contact/page.render.test.ts"`
Expected: FAIL — `./+page.svelte` doesn't exist.

- [ ] **Step 3: Implement — `+page.svelte`**

```svelte
<script lang="ts">
import { api } from "$lib/api-client";
import { Alert, Button, FormField, TextInput } from "@galangdana/ui";

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let name = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let email = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let message = $state("");
let submitting = $state(false);
let error = $state<string | null>(null);
let submitted = $state(false);

async function submit() {
  error = null;
  submitting = true;
  const { error: apiError } = await api["support-tickets"].post({ name, email, message });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim pesan. Periksa kembali isian Anda.";
    return;
  }
  submitted = true;
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Hubungi Kami</h1>

  {#if submitted}
    <Alert variant="success">Pesan Anda telah terkirim. Tim kami akan segera menghubungi Anda.</Alert>
  {:else}
    {#if error}
      <div class="mb-4">
        <Alert variant="error">{error}</Alert>
      </div>
    {/if}

    <form
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormField label="Nama" id="name">
        <TextInput id="name" bind:value={name} />
      </FormField>
      <FormField label="Email" id="email">
        <TextInput id="email" type="email" bind:value={email} />
      </FormField>
      <FormField label="Pesan" id="message">
        <textarea
          id="message"
          bind:value={message}
          rows="5"
          class="w-full rounded-md border border-neutral-300 px-3 py-2 font-sans text-sm"
        ></textarea>
      </FormField>
      <Button type="submit" disabled={submitting}>Kirim</Button>
    </form>
  {/if}
</div>
```

(Confirmed against `packages/ui/src/components/Alert.svelte`: its `Variant` type already includes `"success"` — no change to the component needed.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(consumer)/contact/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add public contact form"
```

---

### Task 7: Frontend — admin FAQ management (`/help-articles`)

**Files:**
- Create: `apps/web/src/routes/(admin)/help-articles/+page.server.ts`
- Create: `apps/web/src/routes/(admin)/help-articles/+page.svelte`
- Create: `apps/web/src/routes/(admin)/help-articles/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /help-articles` (Task 3, reused — see Task 4's note on why there's no separate admin GET), `POST/PUT/DELETE /admin/help-articles*` (Task 4), `createServerApiClient` (existing), the `(admin)` layout's existing auth gate (existing, unchanged).
- Produces: nothing consumed by a later task — this is a leaf page.

- [ ] **Step 1: Write the failing test — `page.render.test.ts`**

```ts
// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_ARTICLE = {
  id: "1",
  slug: "cara-berdonasi",
  question: "Bagaimana cara berdonasi?",
  answer: "Pilih campaign, tentukan nominal, lalu pilih metode pembayaran.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("(admin) /help-articles rendering", () => {
  test("lists existing articles", () => {
    render(Page, { props: { params: {}, form: null, data: { articles: [SAMPLE_ARTICLE] } } });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();
  });

  test("creates a new article via the form", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "2",
          slug: "cara-daftar",
          question: "Bagaimana cara mendaftar?",
          answer: "Klik tombol daftar di halaman utama.",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(Page, { props: { params: {}, form: null, data: { articles: [] } } });
    await fireEvent.input(screen.getByLabelText("Slug"), { target: { value: "cara-daftar" } });
    await fireEvent.input(screen.getByLabelText("Pertanyaan"), {
      target: { value: "Bagaimana cara mendaftar?" },
    });
    await fireEvent.input(screen.getByLabelText("Jawaban"), {
      target: { value: "Klik tombol daftar di halaman utama." },
    });
    await fireEvent.click(screen.getByText("Tambah Artikel"));

    await waitFor(() => {
      expect(screen.getByText("Bagaimana cara mendaftar?")).not.toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/help-articles/page.render.test.ts"`
Expected: FAIL — the route doesn't exist.

- [ ] **Step 3: Implement — `+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client["help-articles"].get();
  if (apiError || !data) {
    error(500, "Gagal memuat daftar artikel");
  }
  return { articles: data.articles };
};
```

(No Eden cast is expected to be needed here — `help_articles` has no enum-typed column, unlike `campaigns.status`/`support_tickets.status`. If `bun run typecheck` disagrees, follow this plan's Global Constraint on the two-part cast fix rather than guessing.)

- [ ] **Step 4: Implement — `+page.svelte`**

```svelte
<script lang="ts">
import { api } from "$lib/api-client";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let articles = $state(data.articles);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let slug = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let question = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let answer = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function createArticle() {
  error = null;
  submitting = true;
  const { data: created, error: apiError } = await api["help-articles"].post({
    slug,
    question,
    answer,
  });
  submitting = false;
  if (apiError || !created) {
    error = "Gagal menambahkan artikel.";
    return;
  }
  articles = [created, ...articles];
  slug = "";
  question = "";
  answer = "";
}

async function deleteArticle(id: string) {
  const { error: apiError } = await api["help-articles"]({ id }).delete();
  if (apiError) {
    error = "Gagal menghapus artikel.";
    return;
  }
  articles = articles.filter((a) => a.id !== id);
}
</script>

<div class="max-w-2xl">
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Tambah Artikel</h2>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <form
    class="mb-8 space-y-3"
    onsubmit={(e) => {
      e.preventDefault();
      createArticle();
    }}
  >
    <FormField label="Slug" id="slug">
      <TextInput id="slug" bind:value={slug} />
    </FormField>
    <FormField label="Pertanyaan" id="question">
      <TextInput id="question" bind:value={question} />
    </FormField>
    <FormField label="Jawaban" id="answer">
      <textarea
        id="answer"
        bind:value={answer}
        rows="4"
        class="w-full rounded-md border border-neutral-300 px-3 py-2 font-sans text-sm"
      ></textarea>
    </FormField>
    <Button type="submit" disabled={submitting}>Tambah Artikel</Button>
  </form>

  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Artikel Saat Ini</h2>
  {#if articles.length === 0}
    <p class="font-sans text-neutral-600">Belum ada artikel.</p>
  {:else}
    <ul class="space-y-4">
      {#each articles as article (article.id)}
        <li class="border-b border-neutral-200 pb-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-sans font-medium text-neutral-900">{article.question}</p>
              <p class="font-sans text-sm text-neutral-600">{article.answer}</p>
            </div>
            <button
              type="button"
              class="shrink-0 font-sans text-sm text-red-600 hover:underline"
              onclick={() => deleteArticle(article.id)}
            >
              Hapus
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

(This task's brief deliberately omits an inline-edit UI for `PUT /admin/help-articles/:id` — create + delete cover the two operations exercised by this task's tests. If time/scope allows, an edit form is a natural, low-risk follow-up using the exact same `api["help-articles"]({ id }).put(...)` bracket-notation call; it is not required for this task to be considered complete, since the master plan's own scope is "Build minimal." Note this as a deviation in the task report if skipped, rather than silently dropping it.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/help-articles/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add admin FAQ article management page"
```

---

### Task 8: Frontend — admin support-ticket queue (`/support-tickets`)

**Files:**
- Create: `apps/web/src/routes/(admin)/support-tickets/+page.server.ts`
- Create: `apps/web/src/routes/(admin)/support-tickets/+page.svelte`
- Create: `apps/web/src/routes/(admin)/support-tickets/page.render.test.ts`

**Interfaces:**
- Consumes: `GET /admin/support-tickets`, `POST /admin/support-tickets/:id/resolve` (Task 4), `createServerApiClient` (existing), the `(admin)` layout's existing auth gate (existing, unchanged).
- Produces: nothing consumed by a later task — this is a leaf page, and the last task in this plan.

- [ ] **Step 1: Write the failing test — `page.render.test.ts`**

```ts
// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_TICKET = {
  id: "1",
  name: "Rina",
  email: "rina@example.test",
  message: "Bagaimana cara membatalkan donasi berulang?",
  status: "open" as const,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
};

describe("(admin) /support-tickets rendering", () => {
  test("with no tickets, shows an empty state", () => {
    render(Page, { props: { params: {}, form: null, data: { tickets: [] } } });
    expect(screen.getByText(/Tidak ada tiket/)).not.toBeNull();
  });

  test("lists open tickets with a resolve button", () => {
    render(Page, { props: { params: {}, form: null, data: { tickets: [SAMPLE_TICKET] } } });
    expect(screen.getByText("Rina")).not.toBeNull();
    expect(screen.getByText("Bagaimana cara membatalkan donasi berulang?")).not.toBeNull();
    expect(screen.getByText("Tandai Selesai")).not.toBeNull();
  });

  test("resolving a ticket removes it from the list", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "resolved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { params: {}, form: null, data: { tickets: [SAMPLE_TICKET] } } });
    await fireEvent.click(screen.getByText("Tandai Selesai"));

    await waitFor(() => {
      expect(screen.queryByText("Rina")).toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/support-tickets/page.render.test.ts"`
Expected: FAIL — the route doesn't exist.

- [ ] **Step 3: Implement — `+page.server.ts`**

```ts
import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { AdminSupportTicketListResponse } from "@galangdana/contracts";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  // support_tickets.status is a Postgres enum -- same Eden response-type
  // over-narrowing risk documented in this plan's Global Constraints and
  // established repeatedly in Phase 3 (e.g.
  // apps/web/src/routes/(admin)/dashboard/+page.server.ts). Cast the base
  // callable, then re-cast the awaited result to the real response shape.
  // biome-ignore lint/suspicious/noExplicitAny: Eden response-type over-narrowing requires casting
  const { data, error: apiError } = (await (client.admin["support-tickets"] as any).get({
    query: {},
  })) as Treaty.TreatyResponse<{
    200: AdminSupportTicketListResponse;
    401: { error: string };
    403: { error: string };
  }>;
  if (apiError || !data) {
    error(500, "Gagal memuat antrian tiket bantuan");
  }
  return { tickets: data.tickets };
};
```

(Verify this cast is actually necessary by first trying the plain, uncast version and running `bun run typecheck` — Task 5's FAQ page turned out NOT to need one because `help_articles` has no enum column. If the plain version typechecks cleanly here too, use that instead and delete the cast — don't apply it speculatively. Note in the task report which case this turned out to be, and why.)

- [ ] **Step 4: Implement — `+page.svelte`**

```svelte
<script lang="ts">
import { api } from "$lib/api-client";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let tickets = $state(data.tickets);
let error = $state<string | null>(null);

async function resolveTicket(id: string) {
  error = null;
  const { error: apiError } = await api.admin["support-tickets"]({ id }).resolve.post();
  if (apiError) {
    error = "Gagal menandai tiket sebagai selesai.";
    return;
  }
  tickets = tickets.filter((t) => t.id !== id);
}
</script>

<div class="max-w-2xl">
  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  {#if tickets.length === 0}
    <p class="font-sans text-neutral-600">Tidak ada tiket yang menunggu.</p>
  {:else}
    <ul class="space-y-4">
      {#each tickets as ticket (ticket.id)}
        <li class="border-b border-neutral-200 pb-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-sans font-medium text-neutral-900">{ticket.name}</p>
              <p class="font-sans text-sm text-neutral-500">{ticket.email}</p>
              <p class="mt-1 font-sans text-sm text-neutral-700">{ticket.message}</p>
            </div>
            <Button variant="secondary" onclick={() => resolveTicket(ticket.id)}>
              Tandai Selesai
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

(Confirmed against `packages/ui/src/components/Button.svelte`: its `Variant` type already includes `"secondary"` — no change to the component needed.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun x vitest run "src/routes/(admin)/support-tickets/page.render.test.ts"`
Expected: PASS.

- [ ] **Step 6: Run the full `apps/web` suite, build, lint, typecheck**

Run: `cd apps/web && bun x vitest run && bun x vite build && cd <worktree root> && bun run lint && bun run typecheck`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add admin support-ticket queue page"
```

---

## Self-Review

**Spec coverage:** every item in the master plan's "FAQ + support" scope decision ("Build minimal — Markdown FAQ + contact form into an admin queue") is covered: a public FAQ page (Task 5), a public contact form feeding a `support_tickets` table (Tasks 1, 3, 6), and an admin queue to view and resolve those submissions (Tasks 4, 8), plus the admin-authoring side of the FAQ content itself (Tasks 4, 7) that "Markdown FAQ" implies but doesn't spell out mechanically (someone has to author the articles — a direct-DB-insert-only FAQ system was considered and rejected as not meeting "self-serve" for whoever operates this platform day to day).

**Placeholder scan:** no task contains "TBD," "add appropriate error handling," or an unshown code block for a step that produces code.

**Type consistency:** `HelpArticleSchema`/`HelpArticleResponse` (Task 2) is used identically in Tasks 3, 4, 5, 7. `SupportTicketSchema`/`AdminSupportTicketListResponse` (Task 2) is used identically in Tasks 4, 8. The `helpRoute` plugin (Task 3) is extended, not replaced or duplicated, in Task 4. Route paths (`/help-articles`, `/support-tickets`, `/admin/help-articles`, `/admin/support-tickets`) are spelled identically across every task that references them.
