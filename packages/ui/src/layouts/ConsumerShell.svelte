<script lang="ts">
import type { Snippet } from "svelte";

interface Props {
  children: Snippet;
}

const { children }: Props = $props();
</script>

<div class="min-h-screen bg-neutral-50">
  <header class="border-b border-neutral-200 bg-white">
    <div class="mx-auto max-w-md px-4 py-3">
      <span class="font-sans text-lg font-bold text-primary-dark">FundForIndonesia</span>
    </div>
  </header>
  <main class="mx-auto max-w-md px-4 py-6">
    {@render children()}
  </main>
  <footer class="border-t border-neutral-200 bg-white">
    <div class="mx-auto max-w-md px-4 py-4 text-center text-xs text-neutral-500">
      fundforindonesia.org diselenggarakan di bawah naungan
      <a
        href="https://yayasanindonesiaemas.com/"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-primary-dark hover:underline"
      >
        Yayasan Indonesia Emas
      </a>
    </div>
  </footer>
</div>
