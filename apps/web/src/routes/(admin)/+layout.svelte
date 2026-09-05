<script lang="ts">
import { AdminShell } from "@fundforindonesia/ui";

const { children } = $props();
</script>

<AdminShell title="Dashboard">
  {@render children()}
</AdminShell>
