<script lang="ts">
import { type MoneyJSON, formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import Badge from "./Badge.svelte";
import Card from "./Card.svelte";

interface CampaignSummaryLike {
  slug: string;
  title: string;
  shortDescription: string;
  coverImageUrl: string;
  category: { id: number; slug: string; title: string };
  campaigner: {
    id: string;
    type: "individual" | "yayasan" | "platform";
    displayName: string;
    avatarUrl: string | null;
    verified: boolean;
  };
  model: "goal" | "program";
  goalAmount: MoneyJSON | null;
  collectedAmount: MoneyJSON;
  availableAmount: MoneyJSON;
  donationCount: number;
  expiresAt: string | null;
  publishedAt: string;
}

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
</script>

<a href="/campaign/{campaign.slug}" class="block">
  <Card padded={false}>
    <img
      src={campaign.coverImageUrl}
      alt={campaign.title}
      class="aspect-[4/3] w-full rounded-t-md object-cover"
      loading="lazy"
    />
    <div class="p-4">
      <Badge variant="neutral">{campaign.category.title}</Badge>
      <h3 class="mt-2 font-sans text-base font-semibold text-neutral-900 line-clamp-2">
        {campaign.title}
      </h3>
      <p class="mt-1 font-sans text-sm text-neutral-600">{campaign.campaigner.displayName}</p>

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
          <p class="mt-2 font-sans text-sm font-semibold text-neutral-900">{formatMoney(collected)}</p>
          <p class="font-sans text-xs text-neutral-600">Terkumpul dari {formatMoney(goal ?? collected)}</p>
        </div>
      {:else}
        <div class="mt-3">
          <p class="font-sans text-sm font-semibold text-neutral-900">{formatMoney(available)}</p>
          <p class="font-sans text-xs text-neutral-600">Donasi tersedia</p>
        </div>
      {/if}
    </div>
  </Card>
</a>
