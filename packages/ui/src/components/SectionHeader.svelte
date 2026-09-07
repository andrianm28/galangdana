<script lang="ts">
interface Props {
  title: string;
  href?: string;
  linkLabel?: string;
}

const { title, href, linkLabel = "Lihat semua" }: Props = $props();
</script>

<div class="flex items-center justify-between gap-4">
  <h2 class="font-sans text-lg font-semibold text-neutral-900">{title}</h2>
  {#if href}
    <a
      {href}
      class="shrink-0 font-sans text-sm font-medium text-primary transition-colors duration-150 hover:text-primary-dark hover:underline"
    >
      {linkLabel} &rsaquo;
    </a>
  {/if}
</div>
