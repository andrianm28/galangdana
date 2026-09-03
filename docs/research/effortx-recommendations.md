# Recommendations from the EffortX (effort.giving) research — applied to GalangDana

**Source:** deep content/business-model + visual/UX audit of effort.giving, a competing donation-crowdfunding platform (2026-09-02). Full research artifact published separately; this document distills only the parts actionable for GalangDana, organized by when they're actionable.

**Status of each item below:** ✅ already satisfied · 🔜 design input for a not-yet-built phase · ❓ open business/legal question for the project owner · 💡 cheap idea worth prototyping

---

## ✅ Already satisfied (Phase 3, checked 2026-09-03)

**Never claim "independently verified" for admin-reviewed status.** EffortX's homepage says "independently verified" while its own FAQ admits internal staff do the review — the single biggest trust-copy mistake found. Checked GalangDana's current campaigner-facing status labels (`apps/web/src/routes/(campaigner)/dashboard/campaigns/+page.svelte`): `pending_review` renders as **"Menunggu Peninjauan"** ("Awaiting review") — already the safe phrasing, not a claim of independent verification. No fix needed. Keep this as a standing copy constraint for any future admin/moderation-facing text: describe review as internal ("ditinjau tim kami"), never as independent third-party verification, unless it genuinely is.

---

## 🔜 Design input for Phase 5–6 (Checkout + Midtrans, Xendit + payouts — not yet built)

**Milestone-based (escrow-style) disbursement is worth designing in, not retrofitting later.** EffortX releases funds in stages (e.g. an initial ~40% once a campaign is funded so work can start, the remainder after evidence of prior-stage spend) rather than paying out the full balance at once. The master plan's current `disbursement_requests` model (request → proof upload → OTP → admin approval → payout) is single-shot, not staged. Before Phase 6 is planned in detail, decide: does `disbursement_requests` need a `milestone` concept (partial releases tied to verified spend evidence), or does the OTP+approval model already give admins enough control that staged release isn't worth the complexity? This is the single highest-leverage idea from the research — flag it explicitly when Phase 6 gets its own plan.

**Fee-on-top vs. fee-deducted changes what a donor sees at checkout.** EffortX adds its fee on top of the donation (donor pays ~103%, campaign shows "100% of your donation") rather than deducting it from the donated amount. The master plan already has `allocation_policies` (platform fee % + org share) but no decision yet on how that's *presented* at checkout. Decide this when Phase 5's checkout UI is designed — it's a display/copy decision layered on the existing money model, not a schema change.

---

## ❓ Open business/legal question (not code — needs the project owner's call)

**Two-entity structure (nonprofit recipient + for-profit operator taking an open fee) is the cleanest legal pattern EffortX uses to combine escrow and monetization.** Whether GalangDana adopts something similar is a legal/business-structure decision, not an engineering one — raised here only so it's on record before Phase 9 (CSR module) or any entity-structure decision gets made elsewhere. No action needed from this plan; surface it to the project owner if/when that decision point actually arrives.

---

## 💡 Cheap UX ideas worth prototyping (no fixed phase — pick up in Phase 4, 7, or 8 planning)

**Denominate progress in impact units, not just Rupiah.** E.g. "22,091 meals delivered of 100,000" alongside the money figure — fits GalangDana's medical/social campaign categories well. Candidate for whichever phase designs campaign-detail progress display (already shipped in Phase 1, could be a follow-up enhancement).

**Recurring donations that overflow to a community fund when their target campaign ends,** instead of the subscription just silently lapsing. Directly relevant to `recurring_schedules`, already in the master plan for Phase 7 (Donor account). Worth designing in when that phase is planned rather than bolted on after.

---

## Process lesson (applies whenever a "transparency" or public-reporting feature is built)

EffortX shipped a `/transparency` page that's still just "Loading..." with no real data — their single biggest credibility claim, unfulfilled in production. If GalangDana ever builds a similar public transparency/impact-reporting surface (candidates: the CSR module's impact reports in Phase 9, or a public disbursement log in Phase 6), do not publish the page until the underlying data is real. Treat this as a standing constraint on that class of feature, not a one-time reminder.
