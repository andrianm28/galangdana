<script lang="ts">
import { AdminShell } from "@galangdana/ui";

const { children } = $props();
</script>

<AdminShell title="Dashboard">
  {@render children()}
</AdminShell>
