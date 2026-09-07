<script lang="ts">
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import type { CampaignSummaryLike } from "../types";
import Avatar from "./Avatar.svelte";
import Badge from "./Badge.svelte";
import Card from "./Card.svelte";
import LedgerTicks from "./LedgerTicks.svelte";

interface Props {
  campaign: CampaignSummaryLike;
}

// Cover images branch on null rather than passing an empty src. src="" is not
// an absent image: several browsers resolve it against the current document and
// re-request the page, and it never fires onerror, so no fallback can hang off
// it. A campaign with no cover renders a labelled band and no <img> at all.
const { campaign }: Props = $props();

const collected = $derived(moneyFromJSON(campaign.collectedAmount));
const available = $derived(moneyFromJSON(campaign.availableAmount));
const goal = $derived(campaign.goalAmount ? moneyFromJSON(campaign.goalAmount) : null);

const progressPercent = $derived.by(() => {
  if (campaign.model !== "goal" || !goal || goal.amount === 0n) return 0;
  const pct = Number((collected.amount * 100n) / goal.amount);
  return Math.min(100, Math.max(0, pct));
});
</script>

<a
  href="/campaign/{campaign.slug}"
  class="block transition-transform duration-100 active:scale-[0.98]"
>
  <Card padded={false}>
    <div class="overflow-hidden rounded-t-md">
      {#if campaign.coverImageUrl}
        <img
          src={campaign.coverImageUrl}
          alt={campaign.title}
          class="aspect-[4/3] w-full object-cover"
          loading="lazy"
        />
      {:else}
        <div data-testid="cover-placeholder" class="aspect-[4/3] w-full bg-neutral-100"></div>
      {/if}
    </div>
    <div class="p-4">
      <Badge variant="neutral">{campaign.category.title}</Badge>
      <h3 class="mt-2 font-sans text-base font-semibold text-neutral-900 line-clamp-2">
        {campaign.title}
      </h3>
      <p class="mt-1 font-sans text-sm text-neutral-600 line-clamp-2">{campaign.shortDescription}</p>

      <div class="mt-2 flex items-center gap-2">
        <Avatar
          name={campaign.campaigner.displayName}
          src={campaign.campaigner.avatarUrl ?? undefined}
          size="sm"
        />
        <span class="font-sans text-sm text-neutral-600">{campaign.campaigner.displayName}</span>
        {#if campaign.campaigner.verified}
          <svg
            role="img"
            aria-label="Terverifikasi"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="size-4 text-info"
          >
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16Zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5Z"
              clip-rule="evenodd"
            />
          </svg>
        {/if}
        {#if campaign.campaigner.type !== "individual"}
          <Badge variant="neutral">ORG</Badge>
        {/if}
      </div>

      {#if campaign.model === "goal"}
        <div class="mt-3">
          <div
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            class="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100"
          >
            <div class="h-full rounded-full bg-primary" style="width: {progressPercent}%"></div>
          </div>
          <LedgerTicks />
          <p class="mt-2 font-sans text-sm font-bold text-primary">{formatMoney(collected)}</p>
          <p class="font-sans text-xs text-neutral-600">Terkumpul dari {formatMoney(goal ?? collected)}</p>
        </div>
      {:else}
        <div class="mt-3">
          <p class="font-mono text-sm font-bold text-primary">{formatMoney(available)}</p>
          <p class="font-sans text-xs text-neutral-600">Donasi tersedia</p>
        </div>
      {/if}
    </div>
  </Card>
</a>
