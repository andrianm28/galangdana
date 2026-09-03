<script lang="ts">
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import type { AdminDisbursementDetailResponse } from "@galangdana/contracts";
import { formatMoney, moneyFromJSON } from "@galangdana/money";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

type DisbursementDetailResult = Treaty.TreatyResponse<{
  200: AdminDisbursementDetailResponse;
  401: { error: string };
  403: { error: string };
  404: { error: string };
}>;

const { data }: PageProps = $props();

let disbursements = $state(data.disbursements);
let error = $state<string | null>(null);

const TYPE_LABELS: Record<string, string> = {
  partial: "Pencairan Sebagian",
  final: "Pencairan Akhir",
};

// Keyed by disbursement id so a previously-fetched detail doesn't need to
// be re-fetched on collapse/re-expand -- an admin toggling back and forth
// between rows shouldn't re-hit the API each time.
let expandedId = $state<string | null>(null);
let details = $state<Record<string, AdminDisbursementDetailResponse>>({});
let detailError = $state<string | null>(null);
let loadingDetailId = $state<string | null>(null);

async function toggleDetail(id: string) {
  detailError = null;
  if (expandedId === id) {
    expandedId = null;
    return;
  }
  expandedId = id;
  if (details[id]) return;
  loadingDetailId = id;
  // Same Eden response-type over-narrowing fix as +page.server.ts's own
  // admin.disbursements list fetch: disbursementRequests.status/.type are
  // Postgres enum columns whose literal unions leak into the inferred
  // response type instead of respecting the declared contract.
  // biome-ignore lint/suspicious/noExplicitAny: Eden response-type over-narrowing requires casting
  const disbursementsClient = api.admin.disbursements as any;
  const { data: detail, error: apiError } = (await disbursementsClient({
    id,
  }).get()) as DisbursementDetailResult;
  loadingDetailId = null;
  if (apiError || !detail) {
    detailError = "Gagal memuat detail pencairan.";
    return;
  }
  details = { ...details, [id]: detail };
}

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
  {#if detailError}
    <p class="mb-4 font-sans text-sm text-red-600">{detailError}</p>
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
              <Button
                variant="secondary"
                size="sm"
                onclick={() => toggleDetail(disbursement.id)}
              >
                {expandedId === disbursement.id ? "Sembunyikan Detail" : "Lihat Detail"}
              </Button>
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

          {#if expandedId === disbursement.id}
            <div class="mt-3 rounded-md bg-neutral-50 p-3 font-sans text-sm text-neutral-700">
              {#if loadingDetailId === disbursement.id}
                <p>Memuat detail...</p>
              {:else if details[disbursement.id]}
                {@const detail = details[disbursement.id]}
                {#if detail}
                  <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt class="text-neutral-500">Bank</dt>
                    <dd>{detail.bankAccount.bankName}</dd>
                    <dt class="text-neutral-500">No. Rekening</dt>
                    <dd>{detail.bankAccount.accountNumber}</dd>
                    <dt class="text-neutral-500">Atas Nama</dt>
                    <dd>{detail.bankAccount.accountHolderName}</dd>
                    <dt class="text-neutral-500">Catatan</dt>
                    <dd>{detail.narrative || "-"}</dd>
                  </dl>
                  {#if detail.proofViewUrl}
                    <a
                      href={detail.proofViewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="mt-2 inline-block font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Lihat Bukti Kebutuhan Dana
                    </a>
                  {/if}
                {/if}
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
