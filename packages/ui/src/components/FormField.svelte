<script lang="ts">
import type { Snippet } from "svelte";
import Label from "./Label.svelte";

interface Props {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  children: Snippet;
}

const { label, id, error, hint, children }: Props = $props();
</script>

<div class="mb-4">
  <Label for={id}>{label}</Label>
  {@render children()}
  {#if error}
    <p id="{id}-error" role="alert" class="mt-1 text-sm text-error font-sans">{error}</p>
  {:else if hint}
    <p id="{id}-hint" class="mt-1 text-sm text-neutral-600 font-sans">{hint}</p>
  {/if}
</div>
