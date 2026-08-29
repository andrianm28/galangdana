<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  for: string;
  children: Snippet;
}

const { for: htmlFor, children }: Props = $props();
</script>

<label for={htmlFor} class="block text-sm font-medium text-neutral-800 mb-1 font-sans">
  {@render children()}
</label>
