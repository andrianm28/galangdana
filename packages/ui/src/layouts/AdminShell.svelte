<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  title?: string;
  children: Snippet;
}

const { title, children }: Props = $props();
</script>

<div class="flex min-h-screen bg-neutral-50">
  <aside class="w-56 shrink-0 border-r border-neutral-200 bg-white px-4 py-6">
    <span class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</span>
  </aside>
  <div class="flex-1">
    {#if title}
      <header class="border-b border-neutral-200 bg-white px-6 py-4">
        <h1 class="font-sans text-xl font-semibold text-neutral-900">{title}</h1>
      </header>
    {/if}
    <main class="px-6 py-6">
      {@render children()}
    </main>
  </div>
</div>
