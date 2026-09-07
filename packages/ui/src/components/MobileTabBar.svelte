<script lang="ts">
interface Props {
  pathname?: string;
}

const { pathname = "" }: Props = $props();

// ConsumerShell already renders desktop nav links named "Beranda" and
// "Bantuan" (see layouts/ConsumerShell.svelte), and happy-dom does not
// evaluate md:hidden, so both nav sets are queryable at once in tests. Each
// link here gets its own aria-label so it has a distinct accessible name from
// its desktop counterpart -- a bare getByRole("link", { name: "Beranda" })
// must keep resolving to exactly one element once a teammate mounts this bar
// alongside ConsumerShell.
const TABS = [
  { href: "/", label: "Beranda", ariaLabel: "Beranda (navigasi bawah)" },
  { href: "/explore", label: "Jelajah", ariaLabel: "Jelajah (navigasi bawah)" },
  { href: "/create/info", label: "Galang Dana", ariaLabel: "Galang Dana (navigasi bawah)" },
  { href: "/jejak-dana", label: "Jejak Dana", ariaLabel: "Jejak Dana (navigasi bawah)" },
  { href: "/help", label: "Bantuan", ariaLabel: "Bantuan (navigasi bawah)" },
];
</script>

<nav
  aria-label="Navigasi bawah"
  class="fixed inset-x-0 bottom-0 z-10 flex border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
>
  {#each TABS as tab (tab.href)}
    <a
      href={tab.href}
      aria-label={tab.ariaLabel}
      aria-current={pathname === tab.href ? "page" : undefined}
      class="group flex flex-1 flex-col items-center gap-0.5 px-1 py-2 transition-transform duration-100 active:scale-[0.98]"
    >
      <span
        class="font-sans text-[11px] text-neutral-600 transition-colors duration-150 group-aria-[current=page]:text-primary-dark"
      >
        {tab.label}
      </span>
    </a>
  {/each}
</nav>
