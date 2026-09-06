<script lang="ts">
import { goto } from "$app/navigation";
import SeoHead from "$lib/SeoHead.svelte";
import { api } from "$lib/api-client";
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import { Badge, Button, Card } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

function donate() {
  goto(`/campaign/${data.campaign.slug}/donation-amount`);
}
const campaign = $derived(data.campaign);

// Local prayer list, seeded from the load: a successful submit prepends
// without a full reload (the load's list is the fallback on revisit).
// Defaults keep older render tests (which only pass campaign data) green.
let prayers = $state(data.prayers ?? []);
let prayerCount = $state(data.prayerCount ?? 0);
let prayerName = $state("");
let prayerMessage = $state("");
let prayerSending = $state(false);
let prayerError: string | null = $state(null);

async function submitPrayer(e: SubmitEvent) {
  e.preventDefault();
  if (!prayerMessage.trim()) {
    prayerError = "Tulis doanya terlebih dahulu.";
    return;
  }
  prayerError = null;
  prayerSending = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden merged-param-name cast, same as revise page
  const { data: result, error: apiError } = await ((api as any)
    .campaigns({
      id: data.campaign.id,
    })
    .prayers.post({
      name: prayerName.trim() || undefined,
      message: prayerMessage.trim(),
    }) as Promise<{ data: { id: string } | null; error: { status: number } | null }>);
  prayerSending = false;
  if (apiError || !result) {
    prayerError =
      apiError?.status === 429
        ? "Terlalu banyak doa terkirim. Coba lagi nanti."
        : "Gagal mengirim doa. Silakan coba lagi.";
    return;
  }
  prayers = [
    {
      id: result.id,
      displayName: prayerName.trim() || "Orang Baik",
      message: prayerMessage.trim(),
      createdAt: new Date().toISOString(),
    },
    ...prayers,
  ];
  prayerCount += 1;
  prayerName = "";
  prayerMessage = "";
}

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


<div class="flex flex-col gap-4">
  <SeoHead
    title={shareTitle}
    description={shareDescription}
    url={data.canonicalUrl}
    image={campaign.coverImageUrl}
    imageAlt={campaign.title}
  />
  {#if campaign.coverImageUrl}
    <img
      src={campaign.coverImageUrl}
      alt={campaign.title}
      class="aspect-[4/3] w-full rounded-md object-cover"
    />
  {:else}
    <div
      class="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-neutral-100 px-4 text-center"
    >
      <span class="font-sans text-sm text-neutral-500">{campaign.category.title}</span>
    </div>
  {/if}

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
      <p class="mt-2 font-sans text-sm text-neutral-600">{campaign.donationCount} donasi</p>
      <div class="mt-4 flex">
        <Button onclick={donate} size="lg">Donasi Sekarang</Button>
      </div>
    </div>
  </Card>

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

  <section id="doa" aria-label="Doa untuk campaign ini" class="rounded-md border border-neutral-200 bg-white p-4">
    <h2 class="font-sans text-base font-semibold text-neutral-900">
      Doa ({prayerCount})
    </h2>

    <form
      class="mt-3 space-y-2"
      onsubmit={submitPrayer}
    >
      {#if prayerError}
        <p class="font-sans text-sm text-error">{prayerError}</p>
      {/if}
      <div>
        <label for="prayer-name" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
          Nama (opsional)
        </label>
        <input
          id="prayer-name"
          type="text"
          maxlength={100}
          bind:value={prayerName}
          placeholder="Orang Baik"
          class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
        />
      </div>
      <div>
        <label for="prayer-message" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
          Doa Anda
        </label>
        <textarea
          id="prayer-message"
          rows="2"
          maxlength={280}
          bind:value={prayerMessage}
          placeholder="Tulis doa terbaik Anda…"
          class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
        ></textarea>
      </div>
      <Button type="submit" disabled={prayerSending}>Kirim Doa</Button>
    </form>

    {#if prayers.length > 0}
      <ul class="mt-4 space-y-3">
        {#each prayers as prayer (prayer.id)}
          <li class="border-t border-neutral-100 pt-3">
            <p class="font-sans text-sm text-neutral-900">{prayer.message}</p>
            <p class="mt-1 font-sans text-xs text-neutral-500">
              {prayer.displayName} · {new Date(prayer.createdAt).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="mt-3 font-sans text-sm text-neutral-500">Belum ada doa. Jadilah yang pertama.</p>
    {/if}
  </section>
</div>
