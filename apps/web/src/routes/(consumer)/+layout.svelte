<script lang="ts">
import { ConsumerShell } from "@galangdana/ui";

const { children } = $props();
</script>

<ConsumerShell>
  {@render children()}
</ConsumerShell>
