<script lang="ts">
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import { daysRemaining } from "../lib/daysRemaining";
import type { CampaignSummaryLike } from "../types";
import Badge from "./Badge.svelte";

// Horizontal variant of CampaignCard for list contexts (search results,
// "Jelajah"). Mirrors CampaignCard's branch on campaign.model exactly:
// program campaigns have goalAmount: null and expiresAt: null, so an
// unbranched version would render a bogus 0% bar and "Sisa hari NaN".
interface Props {
  campaign: CampaignSummaryLike;
}

const { campaign }: Props = $props();

const collected = $derived(moneyFromJSON(campaign.collectedAmount));
const available = $derived(moneyFromJSON(campaign.availableAmount));
const goal = $derived(campaign.goalAmount ? moneyFromJSON(campaign.goalAmount) : null);

const progressPercent = $derived.by(() => {
  if (campaign.model !== "goal" || !goal || goal.amount === 0n) return 0;
  const pct = Number((collected.amount * 100n) / goal.amount);
  return Math.min(100, Math.max(0, pct));
});

const remainingDays = $derived(daysRemaining(campaign.expiresAt));
</script>

<a
  href="/campaign/{campaign.slug}"
  class="flex gap-3 transition-transform duration-100 active:scale-[0.98]"
>
  <div class="size-24 shrink-0 overflow-hidden rounded-md">
    {#if campaign.coverImageUrl}
      <img
        src={campaign.coverImageUrl}
        alt={campaign.title}
        class="size-24 object-cover"
        loading="lazy"
      />
    {:else}
      <div data-testid="cover-placeholder" class="size-24 bg-neutral-100"></div>
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    <Badge variant="neutral">{campaign.category.title}</Badge>
    <h3 class="mt-1 font-sans text-sm font-semibold text-neutral-900 line-clamp-1">
      {campaign.title}
    </h3>
    <p class="font-sans text-xs text-neutral-600">{campaign.campaigner.displayName}</p>

    {#if campaign.model === "goal"}
      <div class="mt-2">
        <div
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
        >
          <div class="h-full rounded-full bg-primary" style="width: {progressPercent}%"></div>
        </div>
        <div class="mt-1.5 flex items-center justify-between gap-2">
          <p class="font-sans text-xs font-semibold text-neutral-900">
            Terkumpul {formatMoney(collected)}
          </p>
          <p class="font-sans text-xs text-neutral-600">Sisa hari {remainingDays ?? "-"}</p>
        </div>
      </div>
    {:else}
      <div class="mt-2">
        <p class="font-mono text-xs font-semibold text-neutral-900">{formatMoney(available)}</p>
        <p class="font-sans text-xs text-neutral-600">Donasi tersedia</p>
      </div>
    {/if}
  </div>
</a>
