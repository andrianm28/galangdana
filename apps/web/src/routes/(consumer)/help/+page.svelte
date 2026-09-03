<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div class="mx-auto max-w-2xl px-4 py-12">
  <h1 class="mb-6 font-sans text-2xl font-bold text-neutral-900">Pusat Bantuan</h1>

  {#if data.articles.length === 0}
    <p class="font-sans text-neutral-600">Belum ada pertanyaan yang tersedia saat ini.</p>
  {:else}
    <div class="space-y-6">
      {#each data.articles as article (article.id)}
        <div class="border-b border-neutral-200 pb-6">
          <h2 class="mb-2 font-sans text-lg font-semibold text-neutral-900">{article.question}</h2>
          <p class="whitespace-pre-wrap font-sans text-neutral-700">{article.answer}</p>
        </div>
      {/each}
    </div>
  {/if}

  <p class="mt-10 font-sans text-neutral-600">
    Tidak menemukan jawaban? <a href="/contact" class="text-primary hover:underline">Hubungi kami</a>.
  </p>
</div>
