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
