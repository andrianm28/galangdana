<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

{#if data.campaigns.length === 0}
  <p class="font-sans text-neutral-600">Tidak ada campaign yang menunggu peninjauan.</p>
{:else}
  <table class="w-full font-sans text-sm">
    <thead>
      <tr class="border-b border-neutral-200 text-left text-neutral-600">
        <th class="py-2 pr-4">Judul</th>
        <th class="py-2 pr-4">Penggalang</th>
        <th class="py-2 pr-4">Kategori</th>
        <th class="py-2 pr-4">Diajukan</th>
      </tr>
    </thead>
    <tbody>
      {#each data.campaigns as campaign (campaign.id)}
        <tr class="border-b border-neutral-100">
          <td class="py-2 pr-4">
            <a href="/campaigns/{campaign.id}" class="font-medium text-primary hover:underline">
              {campaign.title}
            </a>
          </td>
          <td class="py-2 pr-4 text-neutral-700">{campaign.campaignerName}</td>
          <td class="py-2 pr-4 text-neutral-700">{campaign.categoryTitle}</td>
          <td class="py-2 pr-4 text-neutral-500">
            {campaign.submittedAt ? new Date(campaign.submittedAt).toLocaleDateString("id-ID") : "-"}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
