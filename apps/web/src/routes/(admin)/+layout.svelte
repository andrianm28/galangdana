<script lang="ts">
import { page } from "$app/state";
import { AdminShell } from "@fundforindonesia/ui";

const { children } = $props();

// AdminShell derives a header title from its own nav list, which
// deliberately excludes /campaigns (there is no /campaigns index route,
// only /campaigns/[id] reached from Dashboard's own queue). Without this,
// that page rendered no header and no top-level heading at all -- "has a
// nav entry" and "has a title" need to be two different lists, not one.
const ADMIN_TITLES: Array<{ href: string; title: string }> = [
  { href: "/campaigns", title: "Tinjau Kampanye" },
];
const explicitTitle = $derived(
  ADMIN_TITLES.find((item) => page.url.pathname.startsWith(item.href))?.title,
);
</script>

<AdminShell title={explicitTitle} pathname={page.url.pathname}>
  {@render children()}
</AdminShell>
