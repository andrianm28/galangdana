<script lang="ts">
import PageTitle from "$lib/PageTitle.svelte";
import { formatMoney, moneyFromJSON, terbilangRupiah } from "@fundforindonesia/money";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const donation = $derived(data.donation);
const parsed = $derived(moneyFromJSON(donation.amount));
const amount = $derived(formatMoney(parsed));
// The words are the anti-tampering device: a figure can be edited in an image
// editor, a spelled-out sentence is far harder to alter convincingly.
const inWords = $derived(terbilangRupiah(parsed.amount));

const paidOn = $derived(
  donation.paidAt
    ? new Date(donation.paidAt).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "",
);
const paidAtTime = $derived(
  donation.paidAt
    ? new Date(donation.paidAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : "",
);

const METHOD_LABEL: Record<string, string> = {
  bank_transfer_va: "Transfer bank (Virtual Account)",
  qris_redirect: "QRIS",
};
const method = $derived(METHOD_LABEL[donation.method] ?? donation.method);

// A donor who gave no name is not anonymous by accident -- they chose not to
// put one down, and the receipt should say so in words a person uses, not
// leave a blank line that looks like a bug.
const donorName = $derived(donation.displayName?.trim() || "Sesama (tanpa nama)");
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4 py-8 print:py-0">
  <div class="flex items-center justify-between print:hidden">
    <a
      href="/donation/status/{donation.id}"
      class="font-sans text-sm text-neutral-600 underline-offset-2 hover:underline"
    >
      ← Kembali ke status donasi
    </a>
    <button
      type="button"
      onclick={() => window.print()}
      class="rounded-md border border-neutral-300 px-4 py-2 font-sans text-sm font-medium text-neutral-900 hover:border-neutral-400"
    >
      Cetak atau simpan PDF
    </button>
  </div>

  <article class="rounded-md border border-neutral-300 bg-white p-6 print:border-0 print:p-0">
    <header class="border-b border-neutral-200 pb-4">
      <p class="font-sans text-xs uppercase tracking-wide text-neutral-500">Kuitansi Donasi</p>
      <p class="mt-1 font-sans text-base font-bold text-neutral-900">fundforindonesia.org</p>
      <p class="font-sans text-sm text-neutral-600">
        Diselenggarakan di bawah naungan Yayasan Indonesia Emas
      </p>
    </header>

    <dl class="flex flex-col gap-3 py-5">
      <div class="flex flex-col gap-0.5">
        <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Telah diterima dari</dt>
        <dd class="font-sans text-base text-neutral-900">{donorName}</dd>
      </div>

      <div class="flex flex-col gap-0.5">
        <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Sejumlah</dt>
        <dd class="font-sans text-2xl font-bold tabular-nums text-neutral-900">{amount}</dd>
        <dd class="font-sans text-sm italic text-neutral-700">
          Terbilang: {inWords}
        </dd>
      </div>

      <div class="flex flex-col gap-0.5">
        <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Untuk kampanye</dt>
        <dd class="font-sans text-base text-neutral-900">{donation.campaignTitle}</dd>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-0.5">
          <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Tanggal</dt>
          <dd class="font-sans text-sm text-neutral-900">{paidOn}, pukul {paidAtTime} WIB</dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Metode</dt>
          <dd class="font-sans text-sm text-neutral-900">{method}</dd>
        </div>
      </div>

      <div class="flex flex-col gap-0.5">
        <dt class="font-sans text-xs uppercase tracking-wide text-neutral-500">Nomor donasi</dt>
        <dd class="font-mono text-sm text-neutral-900">{donation.id}</dd>
      </div>
    </dl>

    <footer class="border-t border-neutral-200 pt-4">
      <p class="font-sans text-sm text-neutral-700">
        Kuitansi ini menyatakan bahwa dana di atas telah kami terima. Kuitansi ini
        <span class="font-medium">bukan</span> bukti bahwa dana sudah dicairkan ke penerima —
        pencairan berlangsung terpisah, harus dilampiri bukti, dan disetujui oleh dua orang
        berbeda.
      </p>
      <p class="mt-2 font-sans text-sm text-neutral-700">
        Setiap pencairan kampanye ini tercatat, lengkap dengan tanggalnya, di
        <a
          href="/campaign/{donation.campaignSlug}/pencairan-dana"
          class="font-medium text-primary-dark underline-offset-2 hover:underline"
        >
          halaman jejak dananya
        </a>.
      </p>
      <p class="mt-3 font-sans text-xs text-neutral-500">
        Diterbitkan otomatis oleh sistem. Sah tanpa tanda tangan.
      </p>
    </footer>
  </article>
</div>

<PageTitle title="Kuitansi donasi" />
