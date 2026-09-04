<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const TYPE_LABELS: Record<string, string> = {
  partial: "Pencairan Sebagian",
  final: "Pencairan Akhir",
};
</script>

<div class="mx-auto max-w-2xl px-4 py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Riwayat Pencairan Dana</h1>

  {#if data.disbursements.length === 0}
    <p class="font-sans text-sm text-neutral-600">Belum ada pencairan dana untuk campaign ini.</p>
  {:else}
    <ul class="space-y-4">
      {#each data.disbursements as item, i (i)}
        <li class="rounded-sm border border-neutral-200 p-4">
          <p class="font-sans text-sm font-medium text-neutral-900">
            {TYPE_LABELS[item.type] ?? item.type} - Rp{item.amount.amount}
          </p>
          <p class="font-sans text-xs text-neutral-500">{new Date(item.paidAt).toLocaleDateString("id-ID")}</p>
          <p class="mt-2 font-sans text-sm text-neutral-700">{item.narrative}</p>
        </li>
      {/each}
    </ul>
  {/if}
</div>
