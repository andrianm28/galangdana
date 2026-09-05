<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  children: Snippet;
}

const { children }: Props = $props();

// Only routes that actually exist are linked here. The CI link check crawls
// same-origin <a href> from "/" and fails on any non-200, so a nav entry for
// a page that has not been built yet breaks the build -- which is the correct
// behaviour, and the reason there is no "Galang Dana" entry: the campaigner
// flow has no index page, only /create/[draftId]/step/* and
// /create/document-sample.
const NAV = [
  { href: "/", label: "Beranda" },
  { href: "/search", label: "Cari" },
  { href: "/help", label: "Bantuan" },
  { href: "/contact", label: "Kontak" },
];
</script>

<!--
  The container is max-w-[1200px], NOT max-w-md.

  This shell previously hard-capped every viewport at a ~416px column with no
  navigation at all, which was inherited from Kitabisa without inheriting its
  reason: Kitabisa's web is a deliberate mirror of its app, so a mobile column
  on desktop is a consequence of that strategy. This product has no app, so the
  constraint bought nothing and cost the entire desktop viewport.

  It also cost credibility. effort.giving reads as materially more
  institutionally serious than Kitabisa at a fraction of its scale, largely
  because it uses a real multi-column grid -- desktop layout competence is the
  cheapest credibility available here. And the corporate partnership audience
  evaluates on a laptop, so the desktop view is a commercial surface, not just
  an aesthetic one.
-->
<div class="flex min-h-screen flex-col bg-neutral-50">
  <header class="border-b border-neutral-200 bg-white">
    <div
      class="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6"
    >
      <a href="/" class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</a>
      <nav aria-label="Navigasi utama">
        <ul class="flex flex-wrap items-center gap-x-5 gap-y-1">
          {#each NAV as item (item.href)}
            <li>
              <a
                href={item.href}
                class="font-sans text-sm text-neutral-600 hover:text-primary-dark hover:underline"
              >
                {item.label}
              </a>
            </li>
          {/each}
        </ul>
      </nav>
    </div>
  </header>

  <main class="mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
    {@render children()}
  </main>

  <footer class="border-t border-neutral-200 bg-white">
    <div class="mx-auto max-w-[1200px] px-4 py-4 text-center text-xs text-neutral-500 sm:px-6">
      fundforindonesia.org diselenggarakan di bawah naungan
      <a
        href="https://yayasanindonesiaemas.com/"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-primary-dark hover:underline"
      >
        Yayasan Indonesia Emas
      </a>
    </div>
  </footer>
</div>
