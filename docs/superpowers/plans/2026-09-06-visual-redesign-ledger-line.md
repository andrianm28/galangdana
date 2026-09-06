# Visual Redesign — The Ledger Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the visual redesign described in `docs/design/2026-09-06-visual-redesign-plan.md` — a second, restricted "Record register" (serif + mono, gold "Ledger Line" motif) layered onto the existing warm green/terracotta brand, applied to the specific surfaces that back a claim with an actual record (campaign progress, the disbursement ledger, the kuitansi), plus real navigation for `AdminShell` and a step rail for the campaigner wizard.

**Architecture:** Pure visual/markup changes on top of the existing route tree, existing `packages/ui` components, and existing data already returned by today's APIs. No new routes, no schema changes, no new dependencies — new fonts load via a Google Fonts `<link>`, the same mechanism Plus Jakarta Sans already uses.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Tailwind CSS v4 (`@theme`), `@fundforindonesia/ui` (Svelte component package), `@fundforindonesia/money` (`formatMoney`, `moneyFromJSON`), Vitest (`packages/ui`, `apps/web`), Biome.

**Spec:** `docs/design/2026-09-06-visual-redesign-plan.md` (design brief — read this first; this plan argues from it and does not restate its reasoning).

## Global Constraints

- **The Ledger Line motif — the color `--color-ledger` and the Record register fonts (`--font-serif`, `--font-mono`) — may appear ONLY in the four places named in the spec's Signature section:** `CampaignCard`'s progress ticks, the campaign detail hero's progress ticks, the `pencairan-dana` timeline, and the kuitansi's closing rule and figures. Never on a button, nav item, badge used elsewhere, or any general UI chrome. A task that reaches for `--color-ledger` or the Record register outside those four surfaces is out of scope for that task.
- **`--color-primary` (`#2F7A5F`) and `--color-accent` (`#D97748`) do not change.** Every existing utility class that already references them (`bg-primary`, `text-primary-dark`, `bg-accent`, etc.) keeps working unmodified.
- **No new routes, no new API calls, no schema changes.** Every task consumes data a page's `load` already returns today.
- **No new npm dependencies.** Newsreader and JetBrains Mono load via the same `<link href="https://fonts.googleapis.com/css2?...">` mechanism already used for Plus Jakarta Sans in `apps/web/src/routes/+layout.svelte`.
- **Every task ends with `bun run lint`, `bun run typecheck`, and the test command(s) for the package(s) it touched all green**, run from `/home/ubuntu/ffi`. Tasks touching `packages/ui` run `bun run test:ui`; tasks touching `apps/web` run `bun run test:web`.
- **No test's existing assertions may be weakened or deleted to make it pass** — where an existing test's wording is now stale (e.g. asserts a class this plan intentionally changes), update the assertion to check the new correct behavior, and say so in the commit.

---

### Task 1: Design tokens and Record-register fonts

**Files:**
- Modify: `packages/ui/src/theme.css`
- Modify: `apps/web/src/routes/+layout.svelte`

**Interfaces:**
- Produces: `--color-ink`, `--color-paper`, `--color-ledger` (Tailwind color tokens → `text-ink`, `bg-paper`, `text-ledger`/`bg-ledger`/`border-ledger` utilities), `--font-serif` (→ `font-serif` utility, retargeted from Tailwind's default Georgia stack to Newsreader), `--font-mono` (→ `font-mono` utility, retargeted from Tailwind's default monospace stack to JetBrains Mono). All later tasks consume these utility classes; no task before this one may use them.

- [ ] **Step 1: Add the three new color tokens and the two font tokens to `theme.css`**

Replace the file's `@theme { ... }` block contents with (only the additions are new; everything else is unchanged):

```css
@theme {
  /* Brand: warm & trustworthy. A muted green/teal primary (giving,
     growth, calm) paired with a warm terracotta accent for calls to
     action (donate buttons, primary CTAs) that need to stand out against
     the calmer brand color. Neutral scale is warm-tinted (toward beige),
     not cold blue-gray, to stay consistent with the rest of the palette. */
  --color-primary: #2f7a5f;
  --color-primary-light: #e8f3ee;
  --color-primary-dark: #1f5a44;

  --color-accent: #d97748;
  --color-accent-light: #fbeae0;
  --color-accent-dark: #b85a30;

  /* Record register: for a claim backed by an actual record only --
     campaign progress ticks, the disbursement ledger, the kuitansi. See
     docs/design/2026-09-06-visual-redesign-plan.md's Signature section.
     Never used as a general UI color -- not a button, not a hover state,
     not a nav highlight. */
  --color-ink: #1c1a15;
  --color-paper: #fdfbf8;
  --color-ledger: #b8862e;

  /* Cleared before redefining: Tailwind v4's @theme MERGES with its own
     built-in `neutral` scale rather than replacing it, so any step this
     file doesn't define (300/500/700/950) would otherwise silently fall
     back to Tailwind's cold, zero-chroma default gray -- clashing with
     the warm-tinted steps actually defined below, with no build warning.
     Verified: after this reset, an undefined step (e.g. neutral-500)
     compiles to nothing rather than a wrong color. */
  --color-neutral-*: initial;
  --color-neutral-50: #faf9f7;
  --color-neutral-100: #f3f1ed;
  --color-neutral-200: #e5e1d8;
  --color-neutral-400: #a69c8d;
  --color-neutral-600: #6b6355;
  --color-neutral-800: #3d372c;
  --color-neutral-900: #252017;

  /* success reuses the brand primary -- giving and "this worked" share
     the same color family in a donation product. warning/error/info are
     the only colors outside the warm family, kept deliberately close to
     conventional meanings so they read correctly at a glance. */
  --color-success: #2f7a5f;
  --color-warning: #d9a441;
  --color-error: #c4463a;
  --color-info: #3e7ca6;

  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;

  /* Record register. Retargets Tailwind's default `font-serif`/`font-mono`
     utilities -- every existing `font-mono` usage in the app (the donation
     id on the kuitansi, tabular amounts) now renders in JetBrains Mono
     instead of the generic monospace stack, which is intended: those are
     exactly the numbers/ids this register exists for. */
  --font-serif: "Newsreader", Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", monospace;

  /* Rounded, not sharp -- the "warm & trustworthy" personality's most
     visible signal after color. sm for buttons/inputs/badges, md for
     cards, lg for larger surfaces like modals.
     Cleared before redefining for the same reason as neutral above:
     Tailwind's own default radius scale (xl: 0.75rem, 2xl: 1rem, 3xl:
     1.5rem) would otherwise survive alongside this file's sm/md/lg,
     producing the genuinely confusing result that rounded-xl (0.75rem)
     renders SMALLER than rounded-lg (1.25rem) defined here. rounded-full
     is unaffected by this reset -- it isn't part of the --radius-* scale
     in Tailwind v4 at all, it's a separate hardcoded utility. */
  --radius-*: initial;
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1.25rem;
}
```

- [ ] **Step 2: Load Newsreader and JetBrains Mono alongside Plus Jakarta Sans**

In `apps/web/src/routes/+layout.svelte`, the `<svelte:head>` currently has:

```svelte
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap"
    rel="stylesheet"
  />
```

Replace with:

```svelte
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=JetBrains+Mono:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
```

- [ ] **Step 3: Verify**

Run: `bun run lint && bun run typecheck && bun run test:ui && bun run test:web`
Expected: all green — this task adds tokens and a font link only, nothing yet consumes them, so no existing assertion should move.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/theme.css apps/web/src/routes/+layout.svelte
git commit -m "feat(design): add Record-register tokens (ink, paper, ledger, serif, mono)"
```

---

### Task 2: Badge — a proof-state variant for the Record register

**Files:**
- Modify: `packages/ui/src/components/Badge.svelte`
- Modify: `packages/ui/src/components/Badge.test.ts`

**Interfaces:**
- Consumes: `--color-ledger` (Task 1).
- Produces: `Badge`'s `Variant` type gains `"ledger"`. Consumed by Task 5 (`pencairan-dana`'s proof-state chip).

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/components/Badge.test.ts`, inside the existing `describe("Badge", ...)` block:

```ts
  test("applies the ledger variant's classes, for a proof-state claim only", () => {
    render(Badge, { props: { variant: "ledger", children: textSnippet("Bukti ada, belum bisa dibuka") } });
    const badge = screen.getByText("Bukti ada, belum bisa dibuka");
    expect(badge.className).toContain("text-ledger");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/ui test`
Expected: FAIL — `"ledger"` is not assignable to `Variant`, and `variantClasses` has no such key.

- [ ] **Step 3: Add the variant**

In `packages/ui/src/components/Badge.svelte`:

```ts
type Variant = "neutral" | "success" | "warning" | "error" | "info" | "ledger";
```

```ts
const variantClasses: Record<Variant, string> = {
  neutral: "bg-neutral-100 text-neutral-800",
  success: "bg-primary-light text-primary-dark",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/15 text-error",
  info: "bg-info/15 text-info",
  // Proof-state only -- see docs/design/2026-09-06-visual-redesign-plan.md's
  // Signature section. Never the default for a generic badge.
  ledger: "bg-ledger/10 text-ledger font-mono",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/ui test`
Expected: PASS, all existing `Badge` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/Badge.svelte packages/ui/src/components/Badge.test.ts
git commit -m "feat(ui): add Badge's ledger variant for proof-state claims"
```

---

### Task 3: LedgerTicks component, and CampaignCard's mono figure

**Files:**
- Create: `packages/ui/src/components/LedgerTicks.svelte`
- Create: `packages/ui/src/components/LedgerTicks.test.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/components/CampaignCard.svelte`
- Modify: `packages/ui/src/components/CampaignCard.test.ts`

**Interfaces:**
- Consumes: `--color-ledger`, `--font-mono` (Task 1).
- Produces: `LedgerTicks` (no props — always the fixed 25/50/75 pattern), exported from `packages/ui`'s barrel. Task 4 (the campaign detail hero) imports and uses this same component instead of re-implementing the markup — the two progress-bar instances render the identical milestone-tick pattern, so this is shared once rather than duplicated across `packages/ui` and `apps/web`, matching how `Badge`/`Button`/`Card` are already shared.

**Note:** this task's shape (extract a shared component rather than inline the same markup twice) is a pre-flight correction to the original plan draft, made before Task 3 was dispatched — see the SDD ledger's pre-flight scan entry. `CampaignCard.svelte` already lives in `packages/ui` and is imported into `apps/web`'s pages, so this follows the codebase's existing pattern rather than introducing a new one.

- [ ] **Step 1: Write the failing tests for `LedgerTicks`**

Create `packages/ui/src/components/LedgerTicks.test.ts`:

```ts
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import LedgerTicks from "./LedgerTicks.svelte";

afterEach(() => cleanup());

describe("LedgerTicks", () => {
  test("renders exactly three milestone ticks", () => {
    const { container } = render(LedgerTicks);
    expect(container.querySelectorAll('[data-testid="ledger-tick"]').length).toBe(3);
  });

  test("is decorative, not announced to assistive tech", () => {
    // The bar it sits under already carries role="progressbar" with its own
    // aria-valuenow; these ticks add no new information a screen reader
    // needs read aloud.
    const { container } = render(LedgerTicks);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --cwd packages/ui test`
Expected: FAIL — `LedgerTicks.svelte` does not exist yet.

- [ ] **Step 3: Implement `LedgerTicks`**

Create `packages/ui/src/components/LedgerTicks.svelte`:

```svelte
<!--
  Ledger Line milestone ticks -- see docs/design/2026-09-06-visual-redesign-plan.md's
  Signature section. Fixed at 25/50/75%: these mark where a disbursement
  request would typically land, not a measurement of any specific campaign's
  actual disbursement history (that detail lives on the campaign's own
  pencairan-dana page). Used only under a goal-model progress bar -- a
  program-model campaign has no goal for a milestone to be a fraction of, so
  callers render this only inside their own goal-model branch.
-->
<div class="relative mt-1.5 h-2.5" aria-hidden="true">
  <div class="absolute inset-x-0 top-1 h-px bg-neutral-200"></div>
  {#each [25, 50, 75] as milestone (milestone)}
    <div
      data-testid="ledger-tick"
      class="absolute top-0 h-2.5 w-0.5 rounded-full bg-ledger"
      style="left: {milestone}%"
    ></div>
  {/each}
</div>
```

- [ ] **Step 4: Export it**

In `packages/ui/src/index.ts`, add (alphabetically, between `Label` and `Spinner`):

```ts
export { default as LedgerTicks } from "./components/LedgerTicks.svelte";
```

- [ ] **Step 5: Run `LedgerTicks` tests to verify they pass**

Run: `bun run --cwd packages/ui test`
Expected: PASS for `LedgerTicks.test.ts`.

- [ ] **Step 6: Write the failing tests for `CampaignCard`**

Append to `packages/ui/src/components/CampaignCard.test.ts`, inside `describe("CampaignCard", ...)`:

```ts
  test("a goal-model campaign shows the Ledger Line milestone ticks under the progress bar", () => {
    const { container } = render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    expect(container.querySelectorAll('[data-testid="ledger-tick"]').length).toBe(3);
  });

  test("a program-model campaign shows no Ledger Line ticks (there is no goal to mark milestones against)", () => {
    const { container } = render(CampaignCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    expect(container.querySelectorAll('[data-testid="ledger-tick"]').length).toBe(0);
  });

  test("a program-model campaign's available amount renders in the mono register", () => {
    const { container } = render(CampaignCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    const amount = screen.getByText("Rp200.000.000");
    expect(amount.className).toContain("font-mono");
    // Never the general UI font for this figure -- it's a stated fact, not a
    // headline, and the Record register is what marks that distinction.
    expect(container.querySelector('[data-testid="ledger-tick"]')).toBeNull();
  });
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `bun run --cwd packages/ui test`
Expected: FAIL — `CampaignCard` renders no ticks yet, and the program-model amount is not yet `font-mono`.

- [ ] **Step 8: Implement in `CampaignCard`**

In `packages/ui/src/components/CampaignCard.svelte`, add the import:

```ts
import LedgerTicks from "./LedgerTicks.svelte";
```

Replace the `{#if campaign.model === "goal"} ... {:else} ... {/if}` block with:

```svelte
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
          <LedgerTicks />
          <p class="mt-2 font-sans text-sm font-semibold text-neutral-900">{formatMoney(collected)}</p>
          <p class="font-sans text-xs text-neutral-600">Terkumpul dari {formatMoney(goal ?? collected)}</p>
        </div>
      {:else}
        <div class="mt-3">
          <p class="font-mono text-sm font-semibold text-neutral-900">{formatMoney(available)}</p>
          <p class="font-sans text-xs text-neutral-600">Donasi tersedia</p>
        </div>
      {/if}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun run --cwd packages/ui test`
Expected: PASS, all existing `CampaignCard` tests (goal progress bar, program "Donasi tersedia", cover placeholder, formatting, link href) still pass unchanged.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/components/LedgerTicks.svelte packages/ui/src/components/LedgerTicks.test.ts packages/ui/src/index.ts packages/ui/src/components/CampaignCard.svelte packages/ui/src/components/CampaignCard.test.ts
git commit -m "feat(ui): add a shared LedgerTicks component, used by CampaignCard"
```

---

### Task 4: Campaign detail hero — two-column layout and Ledger Line ticks

**Files:**
- Modify: `apps/web/src/routes/(consumer)/campaign/[slug]/+page.svelte`

**Interfaces:**
- Consumes: `LedgerTicks` from `@fundforindonesia/ui` (Task 3). No prop/data changes — `data.campaign` already carries everything used.

This fixes the UAT finding that a full-bleed `aspect-[4/3]` cover image, in a page with no max-height, pushes the title, progress, and donate button below the fold on desktop (the page renders inside `ConsumerShell`'s `max-w-[1200px]` container, so the image alone can exceed 800px tall). No existing test asserts DOM structure for this page (verified: `page.render.test.ts` only checks text/role), so the restructuring is unconstrained by anything except keeping every existing string/role assertion true.

- [ ] **Step 1: Import `LedgerTicks` and restructure the top of the page**

In `apps/web/src/routes/(consumer)/campaign/[slug]/+page.svelte`, change:

```ts
import { Badge, Button, Card } from "@fundforindonesia/ui";
```

to:

```ts
import { Badge, Button, Card, LedgerTicks } from "@fundforindonesia/ui";
```

Then replace from the closing `</script>` through the `<Card>...</Card>` block (i.e. everything up to but not including `<div class="font-sans text-neutral-900">` — the story section) with:

```svelte
<div class="flex flex-col gap-4 md:gap-6">
  <SeoHead
    title={shareTitle}
    description={shareDescription}
    url={data.canonicalUrl}
    image={campaign.coverImageUrl}
    imageAlt={campaign.title}
  />

  <div class="grid gap-4 md:grid-cols-[1.3fr_1fr] md:gap-6">
    {#if campaign.coverImageUrl}
      <img
        src={campaign.coverImageUrl}
        alt={campaign.title}
        class="aspect-[4/3] w-full rounded-md object-cover md:aspect-[21/9]"
      />
    {:else}
      <div
        class="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-neutral-100 px-4 text-center md:aspect-[21/9]"
      >
        <span class="font-sans text-sm text-neutral-500">{campaign.category.title}</span>
      </div>
    {/if}

    <Card>
      <div class="flex h-full flex-col">
        <Badge variant="neutral">{campaign.category.title}</Badge>
        <h1 class="mt-2 font-sans text-xl font-bold text-neutral-900">{campaign.title}</h1>
        <p class="mt-1 font-sans text-sm text-neutral-600">
          Digalang oleh <span class="font-medium">{campaign.campaigner.displayName}</span>
          {#if campaign.campaigner.verified}
            <span class="text-primary">&middot; Terverifikasi</span>
          {/if}
        </p>

        <div class="mt-4">
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
            <LedgerTicks />
            <p class="mt-3 font-sans text-lg font-bold text-neutral-900">{formatMoney(collected)}</p>
            <p class="font-sans text-sm text-neutral-600">Terkumpul dari {formatMoney(goal ?? collected)}</p>
            {#if daysLeft !== null}
              <p class="mt-2 font-sans text-sm text-neutral-600">{daysLeft} hari lagi</p>
            {/if}
          {:else}
            <p class="font-mono text-lg font-bold text-neutral-900">{formatMoney(available)}</p>
            <p class="font-sans text-sm text-neutral-600">Donasi tersedia</p>
          {/if}
          <p class="mt-2 font-sans text-sm text-neutral-600">{campaign.donationCount} donasi</p>
        </div>

        <div class="mt-4 flex">
          <Button onclick={donate} size="lg">Donasi Sekarang</Button>
        </div>
      </div>
    </Card>
  </div>
```

Everything from `<div class="font-sans text-neutral-900">` (the story section) onward is unchanged.

- [ ] **Step 2: Verify**

Run: `bun run --cwd apps/web test -- page.render.test.ts` (or `bun run test:web` for the full suite)
Expected: PASS — every existing assertion (`getByText("Test Goal Campaign")`, `getByRole("progressbar")`, `getByText(/Terkumpul dari/)`, `getByText("5 hari lagi")`, `getByText(/Terverifikasi/)`, the SeoHead meta assertions, the prayer-form assertions below the untouched section) still holds, since none of them depended on the DOM structure this step changed.

Run also: `bun run lint && bun run typecheck`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(consumer)/campaign/[slug]/+page.svelte"
git commit -m "fix(web): cap the campaign hero's height on desktop, add Ledger Line ticks"
```

---

### Task 5: Disbursement ledger (`pencairan-dana`) — the Record register

**Files:**
- Modify: `apps/web/src/routes/(consumer)/campaign/[slug]/pencairan-dana/+page.svelte`

**Interfaces:**
- Consumes: `--color-ledger`, `--color-paper`, `--font-serif`, `--font-mono`, `Badge`'s `"ledger"` variant (Tasks 1–2).

This is the fullest expression of the Record register: the page whose entire job is to state what has happened, with dates and proof, without editorializing. No prop/data changes.

- [ ] **Step 1: Replace the non-empty-state markup**

In `apps/web/src/routes/(consumer)/campaign/[slug]/pencairan-dana/+page.svelte`, add the `Badge` import:

```ts
import { Badge } from "@fundforindonesia/ui";
```

Replace the `{:else} ... {/if}` branch (everything from `{:else}` through the closing `{/if}` that wraps the disbursement list, i.e. the entire non-empty-state block including its trailing explanatory paragraph) with:

```svelte
  {:else}
    <div class="rounded-md border border-neutral-200 bg-paper p-6">
      <div class="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-4">
        <span class="font-sans text-sm text-neutral-600">
          {data.disbursements.length} pencairan
        </span>
        <span class="font-mono text-sm font-semibold text-ink tabular-nums">
          Total {formatMoney({ amount: total, currency })}
        </span>
      </div>

      <!--
        The Ledger Line as a timeline connector: a dotted rule down the left
        edge, a small ring at each entry. See
        docs/design/2026-09-06-visual-redesign-plan.md's Signature section --
        this is the second of its three sanctioned appearances.
      -->
      <ol class="relative flex flex-col gap-6 pl-6">
        <div
          class="absolute inset-y-1 left-[5px] w-px"
          style="background-image: repeating-linear-gradient(to bottom, var(--color-ledger) 0 4px, transparent 4px 8px)"
          aria-hidden="true"
        ></div>
        {#each data.disbursements as item (item.paidAt)}
          <li class="relative">
            <span
              class="absolute -left-6 top-0.5 size-2.5 rounded-full border-2 border-ledger bg-white"
              aria-hidden="true"
            ></span>
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span class="font-serif text-base text-ink">
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              <span class="font-mono text-base font-semibold text-ink tabular-nums">
                {formatMoney(moneyFromJSON(item.amount))}
              </span>
            </div>

            {#if item.narrative}
              <p class="mt-2 font-sans text-sm text-neutral-700">{item.narrative}</p>
            {/if}

            <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-neutral-500">
              {#if item.approvedAt}
                <div class="flex gap-1">
                  <dt>Disetujui</dt>
                  <dd class="text-neutral-700">{formatDate(item.approvedAt)}</dd>
                </div>
              {/if}
              <div class="flex gap-1">
                <dt>Cair</dt>
                <dd class="text-neutral-700">{formatDate(item.paidAt)}</dd>
              </div>
            </dl>

            <p class="mt-3">
              <Badge variant={item.proofState === "ada_tertutup" ? "ledger" : "neutral"}>
                {PROOF_LABELS[item.proofState] ?? item.proofState}
              </Badge>
            </p>
          </li>
        {/each}
      </ol>
    </div>

    <p class="font-sans text-xs text-neutral-500">
      Dokumen bukti sudah kami terima sebelum dana cair, tetapi belum bisa dibuka untuk umum:
      isinya memuat data pribadi penerima manfaat, dan kami belum punya proses penyensorannya.
      Kami tidak akan menampilkannya sebelum proses itu ada.
    </p>
  {/if}
```

The empty-state (`{#if data.disbursements.length === 0}`) branch above it is unchanged.

- [ ] **Step 2: Verify**

Run: `bun run --cwd apps/web test -- pencairan-dana` (or the full `bun run test:web`)
Expected: PASS — every existing assertion is text-content-based (`"Rp5.000.000"`, `/Total\s+Rp7\.500\.000/`, `"2 pencairan"`, `"Bukti ada, belum bisa dibuka"`, `"Belum ada bukti"`, `"Pencairan sebagian"`, `"Pencairan akhir"`, the narrative strings) and none of that text changed.

Run also: `bun run lint && bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(consumer)/campaign/[slug]/pencairan-dana/+page.svelte"
git commit -m "feat(web): apply the Record register and Ledger Line timeline to pencairan-dana"
```

---

### Task 6: Kuitansi — the Record register and the closing rule

**Files:**
- Modify: `apps/web/src/routes/(consumer)/donation/[id]/kuitansi/+page.svelte`

**Interfaces:**
- Consumes: `--color-ledger`, `--color-paper`, `--font-serif` (Task 1).

This is the third and last sanctioned appearance of the Ledger Line, and the first place the Record register appears for real in this app (the earlier claim that it already existed here was a documentation error, corrected in the spec — see Task 1's font work, which this task is the reason for).

- [ ] **Step 1: Apply the serif register to the attested facts, and the closing rule**

In `apps/web/src/routes/(consumer)/donation/[id]/kuitansi/+page.svelte`, make these four replacements inside the `<article>`:

Replace:
```svelte
      <div class="flex flex-col gap-0.5">
        <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Telah diterima dari</dt>
        <dd class="font-sans text-base text-neutral-900">{donorName}</dd>
      </div>
```
with:
```svelte
      <div class="flex flex-col gap-0.5">
        <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Telah diterima dari</dt>
        <dd class="font-serif text-base text-ink">{donorName}</dd>
      </div>
```

Replace:
```svelte
        <dd class="font-sans text-2xl font-bold tabular-nums text-neutral-900">{amount}</dd>
        <dd class="font-sans text-sm italic text-neutral-700">
          Terbilang: {inWords}
        </dd>
```
with:
```svelte
        <dd class="font-mono text-2xl font-bold tabular-nums text-ink">{amount}</dd>
        <dd class="font-serif text-sm italic text-neutral-700">
          Terbilang: {inWords}
        </dd>
```

Replace:
```svelte
        <dd class="font-sans text-base text-neutral-900">{donation.campaignTitle}</dd>
```
with:
```svelte
        <dd class="font-serif text-base text-ink">{donation.campaignTitle}</dd>
```

Replace the `<footer>`'s closing paragraph and add the Ledger Line rule after it:
```svelte
      <p class="mt-3 font-sans text-xs text-neutral-500">
        Diterbitkan otomatis oleh sistem. Sah tanpa tanda tangan.
      </p>
    </footer>
```
with:
```svelte
      <p class="mt-3 font-sans text-xs text-neutral-500">
        Diterbitkan otomatis oleh sistem. Sah tanpa tanda tangan.
      </p>
      <!--
        The Ledger Line's third and last sanctioned appearance -- see
        docs/design/2026-09-06-visual-redesign-plan.md's Signature section.
        A plain hairline with a single node, not a repeating pattern: this
        is a closing mark, not a connector between multiple entries the way
        it is on pencairan-dana.
      -->
      <div class="relative mt-3 h-3 print:hidden" aria-hidden="true">
        <div class="absolute inset-x-0 top-1.5 h-px bg-ledger opacity-50"></div>
        <div class="absolute left-0 top-0.5 size-2 rounded-full bg-ledger"></div>
      </div>
    </footer>
```

(`print:hidden` on the rule: it's a screen-only trust signal, not part of the printed/PDF record — the printed kuitansi's authority comes from its content, not a gold line a black-and-white printer will render as flat gray.)

- [ ] **Step 2: Verify**

Run: `bun run --cwd apps/web test -- kuitansi`
Expected: PASS — every existing assertion in `page.render.test.ts` and `page.server.test.ts` checks text content or attributes (`noindex`, the `href`s, the donor-name/campaign-title/amount/terbilang text), none of which changed.

Run also: `bun run lint && bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(consumer)/donation/[id]/kuitansi/+page.svelte"
git commit -m "feat(web): apply the Record register and closing Ledger Line to the kuitansi"
```

---

### Task 7: AdminShell — real navigation and a truthful page title

**Files:**
- Modify: `packages/ui/src/layouts/AdminShell.svelte`
- Modify: `packages/ui/src/layouts/AdminShell.test.ts`
- Modify: `apps/web/src/routes/(admin)/+layout.svelte`

**Interfaces:**
- Produces: `AdminShell` reads `$app/state`'s `page` itself (same pattern already used in the campaigner wizard's `+layout.svelte`) to compute both the active nav item and, when no explicit `title` prop is given, a per-route title. `AdminShell`'s existing `title` prop stays supported (an explicit title always wins), so `+layout.svelte` can stop hardcoding `"Dashboard"` by simply no longer passing a `title` at all.

Today `apps/web/src/routes/(admin)/+layout.svelte` passes `title="Dashboard"` unconditionally, so every admin page's header reads "Dashboard" regardless of which page is open — and the sidebar has no links at all, so every admin route is reached by typed URL. Fixing the title is a direct, minimal consequence of adding real nav (a nav with an always-wrong active page would be worse than no nav), not a separate feature.

- [ ] **Step 1: Write the failing tests**

Replace `packages/ui/src/layouts/AdminShell.test.ts` in full with:

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/dashboard" }));
vi.mock("$app/state", () => ({
  get page() {
    return { url: { pathname: pathname.value } };
  },
}));

afterEach(() => {
  cleanup();
  pathname.value = "/dashboard";
});

describe("AdminShell", () => {
  test("renders a sidebar with the FundForIndonesia wordmark, a title, and the page content", async () => {
    const AdminShell = (await import("./AdminShell.svelte")).default;
    render(AdminShell, { props: { title: "Dashboard", children: textSnippet("Panel content") } });
    expect(screen.getByText("FundForIndonesia")).not.toBeNull();
    expect(screen.getByText("Dashboard")).not.toBeNull();
    expect(screen.getByText("Panel content")).not.toBeNull();
  });

  test("does not constrain content width the way ConsumerShell does", async () => {
    const AdminShell = (await import("./AdminShell.svelte")).default;
    const { container } = render(AdminShell, { props: { children: textSnippet("x") } });
    const main = container.querySelector("main");
    expect(main?.className).not.toContain("max-w-md");
  });

  test("renders navigation to every route (admin)/ actually has an index page for", async () => {
    const AdminShell = (await import("./AdminShell.svelte")).default;
    render(AdminShell, { props: { children: textSnippet("x") } });
    // Deliberately excludes /campaigns/[id]: there is no /campaigns index
    // page, only campaign detail reached from the Dashboard's own queue --
    // a nav entry for it would 404 on click.
    const expected = [
      ["Dashboard", "/dashboard"],
      ["Pencairan", "/disbursements"],
      ["Artikel Bantuan", "/help-articles"],
      ["Tiket Dukungan", "/support-tickets"],
    ];
    for (const [label, href] of expected) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  test("marks the current route's nav item active, and no other", async () => {
    pathname.value = "/disbursements";
    const AdminShell = (await import("./AdminShell.svelte")).default;
    render(AdminShell, { props: { children: textSnippet("x") } });
    expect(screen.getByRole("link", { name: "Pencairan" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
  });

  test("derives the header title from the route when no explicit title is given", async () => {
    pathname.value = "/help-articles";
    const AdminShell = (await import("./AdminShell.svelte")).default;
    render(AdminShell, { props: { children: textSnippet("x") } });
    expect(screen.getByRole("heading", { name: "Artikel Bantuan" })).not.toBeNull();
  });

  test("an explicit title prop still wins over the route-derived one", async () => {
    pathname.value = "/dashboard";
    const AdminShell = (await import("./AdminShell.svelte")).default;
    render(AdminShell, { props: { title: "Tinjau Kampanye", children: textSnippet("x") } });
    expect(screen.getByRole("heading", { name: "Tinjau Kampanye" })).not.toBeNull();
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --cwd packages/ui test`
Expected: FAIL — `AdminShell` has no nav, no route-derived title, and doesn't import `$app/state` yet.

- [ ] **Step 3: Implement**

Replace `packages/ui/src/layouts/AdminShell.svelte` in full with:

```svelte
<script lang="ts">
import { page } from "$app/state";
import type { Snippet } from "svelte";

interface Props {
  title?: string;
  children: Snippet;
}

const { title, children }: Props = $props();

// Only routes (admin)/ actually has an index page for. There is no
// /campaigns index route -- campaign review is reached from Dashboard's own
// queue, keyed by id -- so it has no nav entry of its own; linking it here
// would 404 on click.
const NAV: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/disbursements", label: "Pencairan" },
  { href: "/help-articles", label: "Artikel Bantuan" },
  { href: "/support-tickets", label: "Tiket Dukungan" },
];

// The header used to read the literal string "Dashboard" on every admin
// page, because +layout.svelte passed that as a hardcoded title regardless
// of route. Falling back to a route-derived title here -- rather than
// requiring every caller to pass the right one -- means the header can
// never drift out of sync with the sidebar's own active-item logic below,
// since both read the same page.url.pathname.
const routeTitle = $derived(NAV.find((item) => page.url.pathname.startsWith(item.href))?.label);
const resolvedTitle = $derived(title ?? routeTitle);
</script>

<div class="flex min-h-screen bg-neutral-50">
  <aside class="w-56 shrink-0 border-r border-neutral-200 bg-white px-4 py-6">
    <span class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</span>
    <nav aria-label="Navigasi admin" class="mt-6">
      <ul class="flex flex-col gap-1">
        {#each NAV as item (item.href)}
          {@const active = page.url.pathname.startsWith(item.href)}
          <li>
            <a
              href={item.href}
              aria-current={active ? "page" : undefined}
              class="block rounded-sm px-3 py-2 font-sans text-sm {active
                ? 'bg-primary-light font-semibold text-primary-dark'
                : 'text-neutral-600 hover:bg-neutral-100'}"
            >
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>
  </aside>
  <div class="flex-1">
    {#if resolvedTitle}
      <header class="border-b border-neutral-200 bg-white px-6 py-4">
        <h1 class="font-sans text-xl font-semibold text-neutral-900">{resolvedTitle}</h1>
      </header>
    {/if}
    <main class="px-6 py-6">
      {@render children()}
    </main>
  </div>
</div>
```

- [ ] **Step 4: Stop hardcoding the title**

In `apps/web/src/routes/(admin)/+layout.svelte`, replace:

```svelte
<AdminShell title="Dashboard">
  {@render children()}
</AdminShell>
```

with:

```svelte
<AdminShell>
  {@render children()}
</AdminShell>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run --cwd packages/ui test`
Expected: PASS.

Run also: `bun run lint && bun run typecheck && bun run test:web` (the `apps/web` admin route tests, if any exist for `(admin)/+layout.svelte`, must still pass with no explicit `title`).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/layouts/AdminShell.svelte packages/ui/src/layouts/AdminShell.test.ts "apps/web/src/routes/(admin)/+layout.svelte"
git commit -m "feat(ui): give AdminShell real navigation and a route-truthful title"
```

---

### Task 8: Campaigner wizard — a numbered Record-register step rail

**Files:**
- Modify: `apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.svelte`

**Interfaces:**
- Consumes: `--font-mono` (Task 1). No data changes — `data.draft.track` and the URL path already drive `stepOrder`/`currentIndex` today.

Today's rail is a single plain green bar plus "Langkah X dari Y" in `font-sans`. This is a real, ordered sequence (the campaigner is filling in fields in a fixed order that later becomes a record subject to review), so numbering here is honest, not decorative — it earns the Record register's mono treatment for the step count without needing the full serif/ledger machinery reserved for actual disbursement/kuitansi records.

- [ ] **Step 1: Replace the progress indicator**

In `apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.svelte`, replace:

```svelte
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
```

with:

```svelte
  <div class="mb-6">
    <div class="flex gap-1">
      {#each stepOrder as step, i (step)}
        <div
          class="h-1.5 flex-1 rounded-full {i <= currentIndex ? 'bg-primary' : 'bg-neutral-100'}"
        ></div>
      {/each}
    </div>
    <p class="mt-2 font-mono text-xs text-neutral-600">
      Langkah {String(currentIndex + 1).padStart(2, "0")} / {String(stepOrder.length).padStart(2, "0")}
    </p>
  </div>
```

(A segmented rail, one piece per real step, rather than one continuous bar: the sequence is discrete and the rail should say so — matching what the numbers below it now say explicitly.)

- [ ] **Step 2: Verify**

Run: `bun run test:web`
Expected: PASS — no test file asserts the old "Langkah X dari Y" wording (confirmed absent from every `apps/web/src/**/*.test.ts` before writing this task) or the progress bar's structure.

Run also: `bun run lint && bun run typecheck`

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(campaigner)/create/[draftId]/step/+layout.svelte"
git commit -m "feat(web): give the campaigner wizard a segmented, numbered step rail"
```

---

### Task 9: Final whole-surface review

No file changes expected; this task is a gate, not a diff.

- [ ] **Step 1: Full verification**

Run, from `/home/ubuntu/ffi`:

```bash
bun run lint
bun run typecheck
bun run test:ui
bun run test:web
bun run --env-file=.env test
```

Expected: all green.

- [ ] **Step 2: Grep for Ledger Line leakage**

Run:

```bash
grep -rn "color-ledger\|bg-ledger\|text-ledger\|border-ledger\|font-serif" \
  packages/ui/src packages/ui/src/layouts apps/web/src \
  --include=*.svelte | grep -vE "LedgerTicks\.svelte|campaign/\[slug\]/\+page\.svelte|pencairan-dana/\+page\.svelte|kuitansi/\+page\.svelte"
```

Expected: no output. Any match is a Global Constraint violation — the Ledger Line escaped its four sanctioned surfaces — and must be reverted before this task closes.

- [ ] **Step 3: Manual visual pass**

Start the dev servers (`bun run dev:api`, `bun run dev:web`) and, in a browser, confirm on a real seeded campaign:
- the homepage grid renders `CampaignCard`'s milestone ticks under goal-model bars and none under program-model figures
- the campaign detail hero no longer pushes the donate button below the fold at 1440px wide
- `pencairan-dana` (with at least one seeded disbursement) shows the dotted timeline and a gold-outlined proof badge
- a settled donation's kuitansi shows the serif donor/campaign name, mono amount, and the closing rule (and that the rule disappears in print preview)
- `/dashboard` (as a promoted admin user) shows working sidebar links, and the header title changes when navigating between admin pages

No test can substitute for this step — it is the redesign's actual acceptance criterion, and none of the above are covered by DOM/text assertions strong enough to catch a visually broken layout.

- [ ] **Step 4: Close out**

If Steps 1–3 are clean, the redesign is complete for this plan's scope. Follow `superpowers:finishing-a-development-branch` for merge/PR.
