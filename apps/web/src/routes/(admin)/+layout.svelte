<script lang="ts">
import { page } from "$app/state";
import { AdminShell } from "@fundforindonesia/ui";

const { children } = $props();
</script>

<AdminShell pathname={page.url.pathname}>
  {@render children()}
</AdminShell>
