<script lang="ts">
import { goto } from "$app/navigation";
import SeoHead from "$lib/SeoHead.svelte";
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import { Badge, Button, Card, LedgerTicks } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

function donate() {
  goto(`/campaign/${data.campaign.slug}/donation-amount`);
}
const campaign = $derived(data.campaign);

const collected = $derived(moneyFromJSON(campaign.collectedAmount));
const available = $derived(moneyFromJSON(campaign.availableAmount));
const goal = $derived(campaign.goalAmount ? moneyFromJSON(campaign.goalAmount) : null);

const progressPercent = $derived.by(() => {
  if (campaign.model !== "goal" || !goal || goal.amount === 0n) return 0;
  const pct = Number((collected.amount * 100n) / goal.amount);
  return Math.min(100, Math.max(0, pct));
});

// Link-preview metadata. Indonesian donation traffic moves on WhatsApp
// forwards, so this is the most-viewed surface in the funnel -- and until now
// a forwarded fundforindonesia.org link rendered as a bare grey URL chip,
// because app.html carried no og: tags at all.
//
// The description states the money position rather than repeating the title:
// what a forwarded card has to answer is "how far along is this", and a
// campaign summary is exactly that.
const shareTitle = $derived(`${campaign.title} — FundForIndonesia`);
const shareDescription = $derived(
  campaign.model === "goal" && goal
    ? `${formatMoney(collected)} terkumpul dari ${formatMoney(goal)}. ${campaign.shortDescription}`
    : `${formatMoney(available)} donasi tersedia. ${campaign.shortDescription}`,
);

const daysLeft = $derived.by(() => {
  if (!campaign.expiresAt) return null;
  const ms = new Date(campaign.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
});
</script>


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

  <div class="font-sans text-neutral-900">
    <h2 class="mb-2 text-lg font-semibold">Cerita Campaign</h2>
    <p class="whitespace-pre-line text-sm leading-relaxed">{campaign.story}</p>
  </div>

  <a
    href="/campaign/{campaign.slug}/pencairan-dana"
    class="block rounded-md border border-neutral-200 bg-white p-4 hover:border-neutral-300"
  >
    <span class="font-sans text-sm font-semibold text-neutral-900">Lihat jejak dana</span>
    <span class="mt-1 block font-sans text-sm text-neutral-600">
      Setiap pencairan, tanggalnya, dan status dokumennya. Dana tidak kami cairkan sebelum
      buktinya ada.
    </span>
  </a>
</div>
