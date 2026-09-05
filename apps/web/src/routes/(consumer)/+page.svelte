<script lang="ts">
import { CampaignCard } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="flex flex-col gap-6">
  <div>
    <h1 class="font-sans text-2xl font-bold text-neutral-900">Galang kebaikan bersama</h1>
    <p class="mt-1 font-sans text-neutral-600">
      Bantu sesama melalui donasi yang tepat sasaran dan transparan.
    </p>
  </div>

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
