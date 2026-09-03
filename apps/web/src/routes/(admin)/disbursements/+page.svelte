<script lang="ts">
import { api } from "$lib/api-client";
import { formatMoney, moneyFromJSON } from "@galangdana/money";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let disbursements = $state(data.disbursements);
let error = $state<string | null>(null);

const TYPE_LABELS: Record<string, string> = {
  partial: "Pencairan Sebagian",
  final: "Pencairan Akhir",
};

async function approve(id: string) {
  error = null;
  const { error: apiError } = await api.admin.disbursements({ id }).approve.post();
  if (apiError) {
    error = "Gagal menyetujui pencairan.";
    return;
  }
  // Unlike reject/pay, an approved row must stay visible with its status
  // updated in place -- it's still one of the two statuses this page shows,
  // and now needs its Pay button instead of being discarded.
  disbursements = disbursements.map((d) =>
    d.id === id ? { ...d, status: "approved" as const } : d,
  );
}

async function reject(id: string) {
  const reason = window.prompt("Alasan penolakan:");
  if (!reason) return;
  error = null;
  const { error: apiError } = await api.admin.disbursements({ id }).reject.post({ reason });
  if (apiError) {
    error = "Gagal menolak pencairan.";
    return;
  }
  disbursements = disbursements.filter((d) => d.id !== id);
}

async function pay(id: string) {
  error = null;
  const { error: apiError } = await api.admin.disbursements({ id }).pay.post();
  if (apiError) {
    error = "Gagal memproses pembayaran.";
    return;
  }
  disbursements = disbursements.filter((d) => d.id !== id);
}
</script>

<div class="max-w-3xl">
  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  {#if disbursements.length === 0}
    <p class="font-sans text-neutral-600">Tidak ada pencairan yang menunggu.</p>
  {:else}
    <ul class="space-y-4">
      {#each disbursements as disbursement (disbursement.id)}
        <li class="border-b border-neutral-200 pb-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-sans font-medium text-neutral-900">{disbursement.campaignTitle}</p>
              <p class="font-sans text-sm text-neutral-500">
                {disbursement.type ? (TYPE_LABELS[disbursement.type] ?? disbursement.type) : "-"}
              </p>
              <p class="font-sans text-sm text-neutral-700">
                {formatMoney(moneyFromJSON(disbursement.amount))}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <!--
                Three independent {#if} blocks, not one {#if}/{:else if}
                chain: empirically (see this route's fix report), Svelte
                5.57's else-if reconciliation reuses a Button component
                instance positionally across branches with different child
                counts here, leaving a stale "Tolak" button on-screen after
                an in-place status change to "approved" instead of removing
                it. Independent ifs sidestep that reuse entirely.
              -->
              {#if disbursement.status === "requested"}
                <Button variant="danger" size="sm" onclick={() => reject(disbursement.id)}>
                  Tolak
                </Button>
              {/if}
              {#if disbursement.status === "requested"}
                <Button size="sm" onclick={() => approve(disbursement.id)}>Setujui</Button>
              {/if}
              {#if disbursement.status === "approved"}
                <Button size="sm" onclick={() => pay(disbursement.id)}>Bayar</Button>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
