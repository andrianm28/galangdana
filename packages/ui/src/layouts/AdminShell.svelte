<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  title?: string;
  /**
   * The current route path, e.g. `$app/state`'s `page.url.pathname`.
   * AdminShell lives in packages/ui, a plain Svelte component package with
   * no SvelteKit dependency of its own (no @sveltejs/kit, no sveltekit()
   * Vite plugin) -- it cannot import `$app/state` itself, since that
   * virtual module only resolves inside an app whose Vite config includes
   * SvelteKit's own plugin. The caller (an app that DOES have it) reads
   * the path and passes it down.
   */
  pathname?: string;
  children: Snippet;
}

const { title, pathname = "", children }: Props = $props();

// Only routes (admin)/ actually has an index page for. There is no
// /campaigns index route -- campaign review is reached from Dashboard's own
// queue, keyed by id -- so it has no nav entry of its own; linking it here
// would 404 on click.
const NAV: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/disbursements", label: "Pencairan" },
  { href: "/help-articles", label: "Artikel Bantuan" },
  { href: "/support-tickets", label: "Tiket Dukungan" },
];

// The header used to read the literal string "Dashboard" on every admin
// page, because +layout.svelte passed that as a hardcoded title regardless
// of route. Falling back to a route-derived title here -- rather than
// requiring every caller to pass the right one -- means the header can
// never drift out of sync with the sidebar's own active-item logic below,
// since both read the same `pathname`.
const routeTitle = $derived(NAV.find((item) => pathname.startsWith(item.href))?.label);
const resolvedTitle = $derived(title ?? routeTitle);
</script>

<div class="flex min-h-screen bg-neutral-50">
  <aside class="w-56 shrink-0 border-r border-neutral-200 bg-white px-4 py-6">
    <span class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</span>
    <nav aria-label="Navigasi admin" class="mt-6">
      <ul class="flex flex-col gap-1">
        {#each NAV as item (item.href)}
          {@const active = pathname.startsWith(item.href)}
          <li>
            <a
              href={item.href}
              aria-current={active ? "page" : undefined}
              class="block rounded-sm px-3 py-2 font-sans text-sm {active
                ? 'bg-primary-light font-semibold text-primary-dark'
                : 'text-neutral-600 hover:bg-neutral-100'}"
            >
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>
  </aside>
  <div class="flex-1">
    {#if resolvedTitle}
      <header class="border-b border-neutral-200 bg-white px-6 py-4">
        <h1 class="font-sans text-xl font-semibold text-neutral-900">{resolvedTitle}</h1>
      </header>
    {/if}
    <main class="px-6 py-6">
      {@render children()}
    </main>
  </div>
</div>
