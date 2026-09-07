<script lang="ts">
import SeoHead from "$lib/SeoHead.svelte";
import { ActionTile, CampaignCard } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>


<div class="flex flex-col gap-6">
  <SeoHead
    title="FundForIndonesia"
    description="Galang dan salurkan donasi, dengan jejak dana yang bisa diperiksa."
  />
  <div>
    <h1 class="font-sans text-2xl font-bold text-neutral-900">Galang kebaikan bersama</h1>
    <p class="mt-1 font-sans text-neutral-600">
      Bantu sesama melalui donasi yang tepat sasaran dan transparan.
    </p>
  </div>

  <div class="grid grid-cols-4 gap-2">
    <ActionTile href="/explore" label="Donasi" icon={donasiIcon} />
    <ActionTile href="/create/info" label="Galang Dana" icon={galangDanaIcon} />
    <ActionTile href="/jejak-dana" label="Jejak Dana" icon={jejakDanaIcon} />
    <ActionTile href="/csr" label="Kolaborasi CSR" icon={kolaborasiCsrIcon} />
  </div>

  {#snippet donasiIcon()}
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-6"
    >
      <path
        d="M12 20.25c-.3 0-.59-.09-.84-.26C7.86 17.57 3.75 14.28 3.75 9.98c0-2.9 2.24-5.23 5-5.23 1.61 0 3.04.79 3.95 2.02.91-1.23 2.34-2.02 3.95-2.02 2.76 0 5 2.33 5 5.23 0 4.3-4.11 7.59-7.41 10.01-.25.17-.54.26-.84.26Z"
      />
    </svg>
  {/snippet}

  {#snippet galangDanaIcon()}
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-6"
    >
      <path
        d="M3.75 9.75v4.5a1.5 1.5 0 0 0 1.5 1.5h1.5l7.5 4.5V5.25l-7.5 4.5h-1.5a1.5 1.5 0 0 0-1.5 1.5Z"
      />
      <path d="M19.5 9a3.75 3.75 0 0 1 0 6" />
    </svg>
  {/snippet}

  {#snippet jejakDanaIcon()}
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-6"
    >
      <path
        d="M6.75 3.75h6.19a1.5 1.5 0 0 1 1.06.44l3.31 3.31a1.5 1.5 0 0 1 .44 1.06V18.75a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5V5.25a1.5 1.5 0 0 1 1.5-1.5Z"
      />
      <path d="M13.5 3.75V7.5a1.5 1.5 0 0 0 1.5 1.5h3.75" />
      <path d="M9 13.5l2 2 4-4.5" />
    </svg>
  {/snippet}

  {#snippet kolaborasiCsrIcon()}
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-6"
    >
      <path d="M4.5 21V6.75L12 3l7.5 3.75V21" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 9.75h.008M12 9.75h.008M15 9.75h.008" />
    </svg>
  {/snippet}

  {#if data.campaigns.length > 0}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.campaigns as campaign (campaign.slug)}
        <CampaignCard {campaign} />
      {/each}
    </div>
  {:else}
    <p class="font-sans text-neutral-600">Belum ada campaign yang bisa ditampilkan saat ini.</p>
  {/if}
</div>
