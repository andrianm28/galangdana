<script lang="ts">
import { CampaignCard } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="flex flex-col gap-4">
  <form method="GET" class="flex gap-2">
    <label for="search-q" class="sr-only">Cari campaign</label>
    <input
      id="search-q"
      name="q"
      type="text"
      value={data.query}
      placeholder="Cari campaign..."
      class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base
        focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
    <button
      type="submit"
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark"
    >
      Cari
    </button>
  </form>

  {#if data.query}
    <p class="font-sans text-sm text-neutral-600">
      {data.results.length} hasil untuk "{data.query}"
    </p>
  {/if}

  {#if data.results.length > 0}
    <div class="grid grid-cols-1 gap-4">
      {#each data.results as campaign (campaign.slug)}
        <CampaignCard {campaign} />
      {/each}
    </div>
  {:else if data.query}
    <p class="font-sans text-neutral-600">Tidak ada campaign yang cocok dengan pencarian Anda.</p>
  {/if}
</div>
