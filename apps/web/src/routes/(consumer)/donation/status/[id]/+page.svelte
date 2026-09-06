<script lang="ts">
import { invalidateAll } from "$app/navigation";
import { formatMoney, moneyFromJSON } from "@fundforindonesia/money";
import { onMount } from "svelte";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const donation = $derived(data.donation);
const amount = $derived(donation.amount ? formatMoney(moneyFromJSON(donation.amount)) : "");

// pending is the only state worth watching. Everything else is terminal, and
// polling a settled donation forever is just load with no answer at the end.
const isPending = $derived(donation.status === "pending");

let copied = $state(false);
async function copyVa() {
  if (!donation.vaNumber) return;
  try {
    await navigator.clipboard.writeText(donation.vaNumber);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  } catch {
    // Clipboard access is denied in some in-app webviews -- which is exactly
    // where this page is most often opened, since donors arrive from a
    // WhatsApp forward. The number stays selectable, so failing quietly is
    // correct: an error toast would be noise about a thing the donor can still
    // do by hand.
  }
}

// The page used to tell the donor to reload it by hand after paying. It now
// asks the server itself. invalidateAll() re-runs the load, so the whole page
// reflects the new status without a manual refresh and without a websocket.
let now = $state(Date.now());
onMount(() => {
  const tick = setInterval(() => {
    now = Date.now();
  }, 1000);

  const poll = setInterval(() => {
    // Don't poll a backgrounded tab: the donor is in their banking app, and
    // the answer is still there when they come back.
    if (!isPending || document.hidden) return;
    void invalidateAll();
  }, 5000);

  const onVisible = () => {
    if (!document.hidden && isPending) void invalidateAll();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    clearInterval(tick);
    clearInterval(poll);
    document.removeEventListener("visibilitychange", onVisible);
  };
});

const remaining = $derived.by(() => {
  if (!donation.expiresAt) return null;
  const ms = new Date(donation.expiresAt).getTime() - now;
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} jam ${minutes} menit` : `${minutes} menit`;
});
</script>

<div class="mx-auto flex max-w-md flex-col gap-5 py-8">
  {#if donation.status === "paid"}
    <div class="rounded-md border border-green-200 bg-green-50 p-5">
      <h1 class="font-sans text-lg font-bold text-green-800">Donasi diterima. Terima kasih.</h1>
      <p class="mt-1 font-sans text-sm text-green-900">
        {amount} sudah kami terima{donation.paidAt
          ? ` pada ${new Date(donation.paidAt).toLocaleString("id-ID")}`
          : ""}.
      </p>
    </div>

    <div class="rounded-md border border-neutral-200 bg-white p-4">
      <p class="font-sans text-sm font-medium text-neutral-900">Yang terjadi berikutnya</p>
      <p class="mt-1 font-sans text-sm text-neutral-600">
        Dana ini masuk ke kampanye, dan tidak kami cairkan sebelum penggalang melampirkan bukti
        dan dua orang berbeda dari tim kami menyetujuinya. Setiap pencairan tercatat di halaman
        jejak dana kampanye, lengkap dengan tanggalnya.
      </p>
      <a
        href="/campaign/{donation.campaignSlug}/pencairan-dana"
        class="mt-3 inline-block font-sans text-sm font-medium text-primary-dark underline-offset-2 hover:underline"
      >
        Lihat jejak dana kampanye ini
      </a>
    </div>

    <a
      href="/donation/{donation.id}/kuitansi"
      class="rounded-md border border-neutral-300 px-4 py-2 text-center font-sans text-sm font-semibold text-neutral-900 hover:border-neutral-400"
    >
      Lihat kuitansi
    </a>

    <p class="font-sans text-xs text-neutral-500">
      Nomor donasi <span class="font-mono">{donation.id}</span>. Simpan sebagai rujukan bila Anda
      perlu menghubungi kami.
    </p>
  {:else if donation.status === "expired" || donation.status === "failed"}
    <div class="rounded-md border border-neutral-300 bg-white p-5">
      <h1 class="font-sans text-lg font-bold text-neutral-900">
        {donation.status === "expired" ? "Batas waktu pembayaran habis" : "Pembayaran tidak selesai"}
      </h1>
      <p class="mt-1 font-sans text-sm text-neutral-600">
        Tidak ada dana yang terpotong. Anda bisa mengulang donasi kapan saja.
      </p>
      <a
        href="/campaign/{donation.campaignSlug}"
        class="mt-3 inline-block rounded-md bg-primary px-4 py-2 font-sans text-sm font-semibold text-white"
      >
        Coba lagi
      </a>
    </div>
  {:else if donation.method === "bank_transfer_va"}
    <div>
      <h1 class="font-sans text-lg font-bold text-neutral-900">Menunggu pembayaran</h1>
      <p class="mt-1 font-sans text-sm text-neutral-600">
        Transfer <span class="font-semibold text-neutral-900">{amount}</span> ke nomor Virtual
        Account di bawah ini.
      </p>
    </div>

    <div class="rounded-md border border-neutral-200 bg-white p-4">
      <p class="font-sans text-xs text-neutral-500">Nomor Virtual Account</p>
      <p class="mt-1 font-mono text-2xl font-bold tracking-wide text-neutral-900">
        {donation.vaNumber}
      </p>
      <button
        type="button"
        onclick={copyVa}
        class="mt-3 w-full rounded-md border border-neutral-300 px-4 py-2 font-sans text-sm font-medium text-neutral-900 hover:border-neutral-400"
      >
        {copied ? "Nomor tersalin" : "Salin nomor"}
      </button>
    </div>

    {#if remaining}
      <p class="font-sans text-sm text-neutral-600">
        Selesaikan dalam <span class="font-medium text-neutral-900">{remaining}</span>.
      </p>
    {/if}

    <p class="font-sans text-sm text-neutral-600" aria-live="polite">
      Halaman ini memeriksa statusnya sendiri. Setelah transfer berhasil, tampilan berubah dengan
      sendirinya — tidak perlu dimuat ulang.
    </p>
  {:else}
    <div>
      <h1 class="font-sans text-lg font-bold text-neutral-900">Menunggu pembayaran</h1>
      <p class="mt-1 font-sans text-sm text-neutral-600">
        Pembayaran QRIS sebesar <span class="font-semibold text-neutral-900">{amount}</span> belum
        selesai.
      </p>
    </div>

    {#if donation.redirectUrl}
      <a
        href={donation.redirectUrl}
        class="rounded-md bg-primary px-4 py-2 text-center font-sans font-semibold text-white"
      >
        Lanjutkan pembayaran
      </a>
    {/if}

    {#if remaining}
      <p class="font-sans text-sm text-neutral-600">
        Selesaikan dalam <span class="font-medium text-neutral-900">{remaining}</span>.
      </p>
    {/if}

    <p class="font-sans text-sm text-neutral-600" aria-live="polite">
      Halaman ini memeriksa statusnya sendiri. Setelah pembayaran berhasil, tampilan berubah dengan
      sendirinya — tidak perlu dimuat ulang.
    </p>
  {/if}
</div>
