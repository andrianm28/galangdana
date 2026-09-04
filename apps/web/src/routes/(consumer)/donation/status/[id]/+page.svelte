<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="mx-auto max-w-sm py-12">
  {#if data.donation.status === "paid"}
    <h1 class="mb-4 font-sans text-xl font-bold text-green-700">Donasi berhasil! Terima kasih.</h1>
  {:else if data.donation.method === "bank_transfer_va"}
    <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Menunggu pembayaran</h1>
    <p class="mb-2 font-sans text-neutral-700">Transfer ke nomor Virtual Account berikut:</p>
    <p class="mb-4 font-sans text-2xl font-mono font-bold text-neutral-900">{data.donation.vaNumber}</p>
    <p class="font-sans text-sm text-neutral-600">
      Halaman ini belum memperbarui status secara otomatis -- muat ulang setelah transfer untuk
      melihat status terbaru.
    </p>
  {:else}
    <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Menunggu pembayaran</h1>
    <p class="mb-4 font-sans text-neutral-700">
      Pembayaran QRIS Anda belum selesai. Lanjutkan ke halaman pembayaran untuk menyelesaikan.
    </p>
    {#if data.donation.redirectUrl}
      <a
        href={data.donation.redirectUrl}
        class="inline-block rounded-md bg-primary px-4 py-2 font-sans font-semibold text-white"
      >
        Lanjutkan Pembayaran
      </a>
    {/if}
    <p class="mt-4 font-sans text-sm text-neutral-600">
      Halaman ini belum memperbarui status secara otomatis -- muat ulang setelah membayar untuk
      melihat status terbaru.
    </p>
  {/if}
</div>
