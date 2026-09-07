<script lang="ts">
import SeoHead from "$lib/SeoHead.svelte";
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import { Badge, Card } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const TYPE_LABELS: Record<string, string> = {
  partial: "Pencairan sebagian",
  final: "Pencairan akhir",
};

// Same reasoning as campaign/[slug]/pencairan-dana/+page.svelte: a gap is
// stated plainly, never styled as an error -- it is information about our
// own record, not a fault of the campaigner.
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
</script>

<div class="mx-auto max-w-2xl px-4 py-12">
  <h1 class="mb-4 font-sans text-2xl font-bold text-neutral-900">Jejak Dana</h1>

  <p class="font-sans text-neutral-700">
    Dana yang terkumpul di fundforindonesia.org tidak langsung bisa dicairkan. Penggalang
    mengajukan rinciannya, melampirkan bukti pengeluaran, dan dua orang berbeda dari tim kami
    harus menyetujuinya sebelum uang benar-benar keluar. Setiap kampanye punya buku pencairannya
    sendiri; halaman ini mengumpulkan seluruh pencairan yang sudah terjadi di semua kampanye,
    yang bisa Anda telusuri lebih lanjut ke buku masing-masing kampanye.
  </p>

  {#if data.disbursements.length === 0}
    <div class="mt-8 rounded-md border border-neutral-200 bg-paper p-6">
      <p class="font-serif text-base text-ink">Belum ada dana yang dicairkan di platform ini.</p>
      <p class="mt-1 font-sans text-sm text-neutral-600">
        Dana baru bisa cair setelah penggalang mengajukan rinciannya, melampirkan bukti, dan dua
        orang berbeda dari tim kami menyetujuinya. Begitu pencairan pertama terjadi, riwayatnya
        akan muncul di sini -- dan riwayat lengkap tiap kampanye selalu bisa dilihat di halaman
        "Jejak dana" kampanye itu sendiri.
      </p>
    </div>
  {:else}
    <ol class="mt-8 flex flex-col gap-4">
      {#each data.disbursements as item (item.campaignSlug + item.paidAt)}
        <li>
          <a href={`/campaign/${item.campaignSlug}/pencairan-dana`} class="block">
            <Card>
              <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span class="font-sans text-sm font-semibold text-primary">
                  {item.campaignTitle}
                </span>
                <span class="font-mono text-base font-semibold text-ink tabular-nums">
                  {formatMoney(moneyFromJSON(item.amount))}
                </span>
              </div>

              <p class="mt-1 font-sans text-sm text-neutral-600">
                {TYPE_LABELS[item.type] ?? item.type}
              </p>

              {#if item.narrative}
                <p class="mt-2 font-sans text-sm text-neutral-700">{item.narrative}</p>
              {/if}

              <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                <dl class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-neutral-500">
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
                <Badge variant={item.proofState === "ada_tertutup" ? "ledger" : "neutral"}>
                  {PROOF_LABELS[item.proofState] ?? item.proofState}
                </Badge>
              </div>
            </Card>
          </a>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<SeoHead
  title={"Jejak Dana"}
  description={"Kumpulan seluruh pencairan dana di fundforindonesia.org: kontrol dua orang, bukti dokumen, dan buku pencairan tiap kampanye."}
/>
