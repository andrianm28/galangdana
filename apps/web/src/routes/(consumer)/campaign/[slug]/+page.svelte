<script lang="ts">
import { formatMoney, moneyFromJSON } from "@galangdana/money";
import { Badge, Card } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
const campaign = $derived(data.campaign);

const collected = $derived(moneyFromJSON(campaign.collectedAmount));
const available = $derived(moneyFromJSON(campaign.availableAmount));
const goal = $derived(campaign.goalAmount ? moneyFromJSON(campaign.goalAmount) : null);

const progressPercent = $derived.by(() => {
  if (campaign.model !== "goal" || !goal || goal.amount === 0n) return 0;
  const pct = Number((collected.amount * 100n) / goal.amount);
  return Math.min(100, Math.max(0, pct));
});

const daysLeft = $derived.by(() => {
  if (!campaign.expiresAt) return null;
  const ms = new Date(campaign.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
});
</script>

<div class="flex flex-col gap-4">
  <img
    src={campaign.coverImageUrl}
    alt={campaign.title}
    class="aspect-[4/3] w-full rounded-md object-cover"
  />

  <Badge variant="neutral">{campaign.category.title}</Badge>
  <h1 class="font-sans text-xl font-bold text-neutral-900">{campaign.title}</h1>
  <p class="font-sans text-sm text-neutral-600">
    Digalang oleh <span class="font-medium">{campaign.campaigner.displayName}</span>
    {#if campaign.campaigner.verified}
      <span class="text-primary">&middot; Terverifikasi</span>
    {/if}
  </p>

  <Card>
    <div>
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
        <p class="mt-3 font-sans text-lg font-bold text-neutral-900">{formatMoney(collected)}</p>
        <p class="font-sans text-sm text-neutral-600">Terkumpul dari {formatMoney(goal ?? collected)}</p>
        {#if daysLeft !== null}
          <p class="mt-2 font-sans text-sm text-neutral-600">{daysLeft} hari lagi</p>
        {/if}
      {:else}
        <p class="font-sans text-lg font-bold text-neutral-900">{formatMoney(available)}</p>
        <p class="font-sans text-sm text-neutral-600">Donasi tersedia</p>
      {/if}
      <p class="mt-2 font-sans text-sm text-neutral-600">{campaign.donationCount} donatur</p>
    </div>
  </Card>

  <div class="font-sans text-neutral-900">
    <h2 class="mb-2 text-lg font-semibold">Cerita Campaign</h2>
    <p class="whitespace-pre-line text-sm leading-relaxed">{campaign.story}</p>
  </div>

  <a
    href="/campaign/{campaign.slug}/pencairan-dana"
    class="font-sans text-sm font-medium text-primary underline-offset-2 hover:underline"
  >
    Riwayat Pencairan Dana
  </a>
</div>
