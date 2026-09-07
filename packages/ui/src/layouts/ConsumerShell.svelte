<script lang="ts">
import type { Snippet } from "svelte";
import MobileTabBar from "../components/MobileTabBar.svelte";

interface Props {
  children: Snippet;
  /**
   * The current route path, e.g. `$app/state`'s `page.url.pathname`.
   * ConsumerShell lives in packages/ui, a plain Svelte component package with
   * no SvelteKit dependency of its own (no @sveltejs/kit, no sveltekit()
   * Vite plugin) -- it cannot import `$app/state` itself, since that
   * virtual module only resolves inside an app whose Vite config includes
   * SvelteKit's own plugin. The caller (an app that DOES have it) reads
   * the path and passes it down. (Same pattern as AdminShell.)
   */
  pathname?: string;
}

const { children, pathname = "" }: Props = $props();

// Only routes that actually exist are linked here. The CI link check crawls
// same-origin <a href> from "/" and fails on any non-200, so a nav entry for
// a page that has not been built yet breaks the build. "Galang Dana" now
// qualifies too: /create/info is a real route (MobileTabBar already links to
// it below md), so it gets a desktop entry here as well.
const NAV = [
  { href: "/", label: "Beranda" },
  { href: "/search", label: "Cari" },
  { href: "/create/info", label: "Galang Dana" },
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

  Below `md`, this shell now also takes on app-like chrome: a sticky header
  with a search affordance instead of the link list, and a fixed bottom tab
  bar (MobileTabBar). None of that overturns the reasoning above -- it only
  extends it. The container here is still max-w-[1200px], the desktop reader
  still gets the full commercial surface unchanged, and the mobile chrome is
  additive, not a reintroduction of the old single-column cap.
-->
<div class="flex min-h-screen flex-col bg-neutral-50 pb-16 md:pb-0">
  <!--
    z-scale: this codebase has exactly two stacked layers. MobileTabBar is
    z-10 (fixed at the bottom of the viewport); this sticky header is z-20,
    above it. Anything added later should say where it sits against these two
    before picking a value.
  -->
  <header
    class="sticky top-0 z-20 border-b border-neutral-200 bg-white transition-shadow duration-150"
  >
    <div
      class="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6"
    >
      <a href="/" class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</a>

      <!--
        Below md, the link list is replaced by a search affordance. This is a
        real <a>, not an <input> -- there is no client-side search on this
        shell, and a non-functional input is worse than an honest link to the
        search page.
      -->
      <a
        href="/search"
        class="flex flex-1 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm text-neutral-600 md:hidden"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          class="h-4 w-4 shrink-0"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m17 17-3.8-3.8" stroke-linecap="round" />
        </svg>
        Cari campaign
      </a>

      <nav aria-label="Navigasi utama" class="hidden md:block">
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
    <div class="mx-auto max-w-[1200px] px-4 py-4 text-center text-xs text-neutral-600 sm:px-6">
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

  <MobileTabBar {pathname} />
</div>
