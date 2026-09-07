<script lang="ts">
import { page } from "$app/state";
import { ConsumerShell } from "@fundforindonesia/ui";

const { children } = $props();
</script>

<ConsumerShell pathname={page.url.pathname}>
  {@render children()}
</ConsumerShell>
