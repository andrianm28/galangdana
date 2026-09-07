# Visual Redesign Plan — FundForIndonesia

**Scope:** whole platform (consumer, campaigner, admin).
**Depth:** visual refresh over the existing structure — no route, IA, or data-model changes. Every page keeps its job; this changes how it looks and which details it surfaces.
**Status:** plan, not yet built. This is the brief to review before any code changes.

## The brief, restated

This is not a generic donation app that happens to need a facelift. Its own copy already makes one claim no competitor's does: *dana tidak kami cairkan sebelum bukti ada dan dua orang menyetujuinya* — money is not released until proof exists and two different people approve it. That line appears on the donation status page, the campaign detail page, and the kuitansi. It is the actual product, not marketing copy, and the current visual system doesn't know it exists: every card, every status, every number is styled identically, so the platform's real differentiator — that a claim here is backed by a record — has no visual language of its own.

Kitabisa wins on reach and mobile polish. effort.giving wins on institutional seriousness. Neither structurally proves disbursement the way this platform's own backend already does (dual-approval, proof-gated, publicly logged). The redesign's job is to make that provable-ness visible, not to out-polish either competitor on their own terms.

## Design plan

### Color

Keep the existing brand family — it is a real, already-chosen identity (warm green + terracotta, warm-tinted neutrals), not a placeholder, and "visual refresh" scope means building on it rather than replacing it. Two additions, both scoped narrowly:

| Token | Value | Role |
|---|---|---|
| `--color-primary` | `#2F7A5F` | unchanged — brand, primary actions |
| `--color-accent` | `#D97748` | unchanged — CTAs that must stand out |
| `--color-ink` | `#1C1A15` | **new.** Headline-weight text only. Richer and warmer than `neutral-900` (`#252017`) — headlines currently sit at body-text weight of color; this gives them their own depth without touching body copy. |
| `--color-paper` | `#FDFBF8` | **new.** The ledger surface (see Signature) — a hair lighter and warmer than `neutral-50`, so a receipt or disbursement record reads as a distinct kind of surface from an ordinary card, the way physical paper differs from a screen. |
| `--color-ledger` | `#B8862E` | **new, and used nowhere except the signature motif below.** A restrained, desaturated gold — not a general accent, not a button color, not a hover state. If it starts appearing on anything that isn't a record or a proof, the system has failed at the one thing it's for. |

No new semantic colors for success/warning/error/info — those are correct as they are.

### Type

Two registers, not one, assigned by what the text is *doing*:

- **Everyday register — Plus Jakarta Sans (unchanged).** Navigation, buttons, forms, campaign titles, body copy, admin table text. This is the platform being used.
- **Record register — Newsreader (serif) for prose, JetBrains Mono for numbers/IDs.** New to the shipped app (correction: an earlier pass of this plan claimed Newsreader was already wired into the kuitansi page — it is not; only `font-mono` on the donation ID is in the real code today. The serif pairing existed only in a one-off UAT report artifact, not in `apps/web`). This plan introduces it for real, in exactly one place first — the kuitansi (`donation/[id]/kuitansi`) — then extends it to every other place something is being *attested* rather than merely shown: the disbursement ledger (`pencairan-dana`), a verified-campaigner statement, an admin approval/reject record. Nowhere else — a wizard step or a search result never switches register, because nothing on those pages is a claim of record.

This is the one real typographic decision in the plan. It ships as a new Google Fonts link plus new `--font-serif`/`--font-mono` tokens (JetBrains Mono is also new — today's `font-mono` utility rides Tailwind's default monospace stack, not a loaded webfont).

### Layout

No new routes, no reordered flows. Per-surface adjustments:

- **Campaign card.** The progress bar gains the Ledger Line (below) instead of being a flat two-tone bar. For `program`-model campaigns (no goal, no bar today), the "Donasi tersedia" figure moves into the mono register so it reads as a stated fact, not a marketing number.
- **Campaign detail hero.** Fixes the UAT finding that a full-bleed cover image pushes title, progress, and the donate button below the fold on desktop. Cap the hero to a fixed aspect ratio (e.g. 21:9) and let the info panel sit adjacent on wide viewports instead of stacked beneath a tall image.
- **Disbursement ledger (`pencairan-dana`).** Becomes the clearest expression of the Record register: each entry (type, amount, proof state, date) rendered as a ledger line, connected by the Ledger Line motif, in the mono/serif pairing. The empty state keeps its existing explanatory copy, restyled into the same register so "nothing has happened yet" reads as a real, trustworthy absence rather than a placeholder.
- **AdminShell.** Today's sidebar has no navigation at all — every admin route is reached by typed URL. This plan adds nav entries for the four routes that have a real index page (Dashboard, Disbursements, Help Articles, Support Tickets) — deliberately not five: `/campaigns/[id]` is reached only from Dashboard's own queue, keyed by id, and has no index route of its own to link. This is a visual-system completion, not a new feature: it surfaces routes that already exist.

  **Correction (found by the final whole-branch review):** an earlier pass of this section miscounted "six existing routes" and promised "status counts rendered in tabular mono." The counts are dropped: they would need admin `load` data this plan does not add (a new API call is out of scope for a visual refresh), not a visual decision reversed.
- **Campaigner wizard.** Give the ~9–10 step flow a slim numbered progress rail. Numbering is honest here — it's a real, ordered sequence, not decoration — set in small caps using the Record register, so a campaigner senses from step one that they're building something that will later be held to account.

### Signature: the Ledger Line

One motif, used in exactly three places, always meaning the same thing — *this claim is backed by a record*:

1. Under a campaign card's progress bar, as milestone ticks.
2. As the connecting line in the disbursement timeline on `pencairan-dana`.
3. As the closing rule beneath "Diterbitkan otomatis oleh sistem. Sah tanpa tanda tangan." on the kuitansi.

It never appears on navigation, buttons, or anything decorative. The discipline is the point: the moment it shows up on something that isn't backed by an actual record, it stops meaning anything.

## Self-review against genericness

Checked against what a generic "trust-focused fintech" redesign would produce for any similar brief: a gold accent color and a serif-for-important-numbers pairing are common moves in that space. What keeps this grounded rather than templated is that neither is invented for the brief — both are lifted directly from copy and a page this exact codebase already ships (the kuitansi, and the "dua orang menyetujuinya" line), and both are used with a hard restriction (ledger color and Record register apply only to actual records, never generally) that a generic pass would not bother enforcing. If execution loosens that restriction — if the gold shows up on a "Donasi Sekarang" button because it looks nice there — the redesign has quietly become the generic version of itself.

## What this plan does not decide

- Exact Tailwind utility values, component-by-component diffs, or a task breakdown — that's the next step (an implementation plan) once this direction is approved.
- Zakat/wakaf category treatment, legal/branding questions — explicitly out of scope per standing project direction (engineering and design only).
- Whether campaigner/admin surfaces get the same polish pass timing as consumer, or ship in a second wave — a sequencing call for whoever schedules the work, not a design decision.
