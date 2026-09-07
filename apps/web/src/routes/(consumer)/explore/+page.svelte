<script lang="ts">
import SeoHead from "$lib/SeoHead.svelte";
import { CategoryChip } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <h1 class="font-sans text-xl font-bold text-neutral-900">Jelajahi Kategori</h1>
    <p class="font-sans text-sm text-neutral-600">
      Pilih kategori untuk melihat campaign yang sedang dibuka untuk donasi.
    </p>
  </div>

  {#if data.categories.length > 0}
    <div class="flex flex-wrap gap-2">
      {#each data.categories as category (category.id)}
        <CategoryChip href={`/explore/${category.slug}`} label={category.title} />
      {/each}
    </div>
  {:else}
    <p class="font-sans text-neutral-600">Kategori tidak dapat dimuat saat ini.</p>
  {/if}
</div>

<SeoHead
  title="Jelajahi Kategori"
  description="Jelajahi kategori campaign yang sedang berjalan di fundforindonesia.org."
/>
