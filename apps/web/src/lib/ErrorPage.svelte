<script lang="ts">
import { page } from "$app/state";

// Without this file SvelteKit renders its own default: the status code and the
// message as bare unstyled text on a blank page, outside the shell, with no
// header, no navigation and no link anywhere. A donor who mistypes a campaign
// slug -- or follows a forwarded link to a campaign that has since closed --
// lands there and is stranded.
const status = $derived(page.status);
const isNotFound = $derived(status === 404);
const heading = $derived(
  isNotFound ? "Halaman ini tidak ada." : "Ada yang tidak beres di sisi kami.",
);
// SvelteKit puts the thrown message here. Ours are already written for a
// person to read ("Kampanye tidak ditemukan"); its own fallbacks are not
// ("Internal Error"), so those are replaced rather than shown.
const detail = $derived(
  page.error?.message && page.error.message !== "Internal Error"
    ? page.error.message
    : isNotFound
      ? "Alamatnya mungkin salah ketik, atau kampanyenya sudah ditutup."
      : "Coba lagi sebentar lagi. Kalau masih sama, beri tahu kami.",
);
</script>

<div class="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
  <p class="font-mono text-sm text-neutral-500">{status}</p>
  <h1 class="font-sans text-2xl font-bold text-neutral-900">{heading}</h1>
  <p class="font-sans text-base text-neutral-600">{detail}</p>

  <div class="mt-2 flex flex-wrap gap-3">
    <a
      href="/"
      class="rounded-md bg-primary px-4 py-2 font-sans text-sm font-semibold text-white"
    >
      Kembali ke beranda
    </a>
    <a
      href="/search"
      class="rounded-md border border-neutral-300 px-4 py-2 font-sans text-sm font-medium text-neutral-900 hover:border-neutral-400"
    >
      Cari kampanye
    </a>
    <a
      href="/contact"
      class="rounded-md border border-neutral-300 px-4 py-2 font-sans text-sm font-medium text-neutral-900 hover:border-neutral-400"
    >
      Hubungi kami
    </a>
  </div>
</div>
