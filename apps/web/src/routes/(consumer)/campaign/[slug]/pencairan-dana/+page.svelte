<script lang="ts">
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const TYPE_LABELS: Record<string, string> = {
  partial: "Pencairan sebagian",
  final: "Pencairan akhir",
};

// A gap is stated, never styled as an error. "belum_ada" means no document is
// on file for this row; it is information about our own record, not a fault of
// the campaigner, and colouring it red would teach the reader to read this page
// as a list of problems rather than a list of facts.
const PROOF_LABELS: Record<string, string> = {
  ada_tertutup: "Bukti ada, belum bisa dibuka",
  belum_ada: "Belum ada bukti",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type LogItem = (typeof data.disbursements)[number];

const total = $derived(
  data.disbursements.reduce((sum: bigint, d: LogItem) => sum + moneyFromJSON(d.amount).amount, 0n),
);
const currency = $derived(data.disbursements[0]?.amount.currency ?? "IDR");
</script>

<div class="flex flex-col gap-6">
  <div>
    <h1 class="font-sans text-xl font-bold text-neutral-900">Jejak dana</h1>
    <p class="mt-1 font-sans text-sm text-neutral-600">
      Setiap rupiah yang keluar dari kampanye ini, beserta tanggal dan dokumennya.
    </p>
  </div>

  {#if data.disbursements.length === 0}
    <div class="rounded-md border border-neutral-200 bg-white p-6">
      <p class="font-sans text-sm font-medium text-neutral-900">Belum ada dana yang dicairkan.</p>
      <p class="mt-1 font-sans text-sm text-neutral-600">
        Dana baru bisa cair setelah penggalang mengajukan rinciannya, melampirkan bukti, dan dua
        orang berbeda dari tim kami menyetujuinya. Begitu ada pencairan, seluruh riwayatnya muncul
        di halaman ini.
      </p>
    </div>
  {:else}
    <div class="rounded-md border border-neutral-200 bg-white">
      <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 p-4">
        <span class="font-sans text-sm text-neutral-600">
          {data.disbursements.length} pencairan
        </span>
        <span class="font-sans text-sm font-semibold text-neutral-900 tabular-nums">
          Total {formatMoney({ amount: total, currency })}
        </span>
      </div>

      <ul>
        {#each data.disbursements as item (item.paidAt)}
          <li class="border-b border-neutral-200 p-4 last:border-b-0">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span class="font-sans text-sm font-medium text-neutral-900">
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              <span class="font-sans text-base font-semibold text-neutral-900 tabular-nums">
                {formatMoney(moneyFromJSON(item.amount))}
              </span>
            </div>

            {#if item.narrative}
              <p class="mt-2 font-sans text-sm text-neutral-700">{item.narrative}</p>
            {/if}

            <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-sans text-xs text-neutral-500">
              {#if item.approvedAt}
                <div class="flex gap-1">
                  <dt>Disetujui</dt>
                  <dd class="text-neutral-700">{formatDate(item.approvedAt)}</dd>
                </div>
              {/if}
              <div class="flex gap-1">
                <dt>Cair</dt>
                <dd class="text-neutral-700">{formatDate(item.paidAt)}</dd>
              </div>
            </dl>

            <p class="mt-3">
              <span
                class="inline-block rounded-sm border px-2 py-0.5 font-sans text-xs {item.proofState ===
                'ada_tertutup'
                  ? 'border-neutral-300 bg-neutral-50 text-neutral-700'
                  : 'border-neutral-200 bg-white text-neutral-500'}"
              >
                {PROOF_LABELS[item.proofState] ?? item.proofState}
              </span>
            </p>
          </li>
        {/each}
      </ul>
    </div>

    <p class="font-sans text-xs text-neutral-500">
      Dokumen bukti sudah kami terima sebelum dana cair, tetapi belum bisa dibuka untuk umum:
      isinya memuat data pribadi penerima manfaat, dan kami belum punya proses penyensorannya.
      Kami tidak akan menampilkannya sebelum proses itu ada.
    </p>
  {/if}
</div>
