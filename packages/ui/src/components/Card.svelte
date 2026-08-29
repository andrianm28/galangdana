<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  padded?: boolean;
  children: Snippet;
}

const { padded = true, children }: Props = $props();
</script>

<div
  data-testid="card"
  class="rounded-md border border-neutral-200 bg-white {padded ? 'p-4' : ''}"
>
  {@render children()}
</div>
