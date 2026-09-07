<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  href: string;
  label: string;
  icon?: Snippet;
}

const { href, label, icon }: Props = $props();
</script>

<a
  {href}
  class="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 font-sans text-sm text-neutral-800 transition-colors duration-150 hover:bg-neutral-100"
>
  {#if icon}
    <span aria-hidden="true" class="flex size-4 items-center justify-center">
      {@render icon()}
    </span>
  {/if}
  {label}
</a>
