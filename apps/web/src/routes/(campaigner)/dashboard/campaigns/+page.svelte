<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  pending_review: "Menunggu Peninjauan",
  needs_revision: "Perlu Revisi",
  active: "Aktif",
  paused: "Dijeda",
  completed: "Selesai",
  rejected: "Ditolak",
};
</script>

<div class="mx-auto max-w-2xl px-4 py-6">
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Campaign Saya</h2>

  {#if data.campaigns.length === 0}
    <p class="font-sans text-sm text-neutral-600">Anda belum punya campaign.</p>
  {:else}
    <ul class="space-y-3">
      {#each data.campaigns as campaign (campaign.id)}
        <li class="flex items-center justify-between rounded-sm border border-neutral-200 p-4">
          <div>
            <p class="font-sans text-sm font-medium text-neutral-900">{campaign.title}</p>
            <p class="font-sans text-xs text-neutral-500">
              {STATUS_LABELS[campaign.status] ?? campaign.status}
            </p>
          </div>
          {#if campaign.status === "needs_revision"}
            <a
              href="/dashboard/campaigns/{campaign.id}/revise"
              class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-primary-dark"
            >
              Perbaiki
            </a>
          {/if}
          {#if campaign.status === "active"}
            <a
              href="/dashboard/campaigns/{campaign.id}/pencairan"
              class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white hover:bg-primary-dark"
            >
              Ajukan Pencairan
            </a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
