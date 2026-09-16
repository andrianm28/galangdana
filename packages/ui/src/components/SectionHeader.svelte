<script lang="ts">
interface Props {
  title: string;
  href?: string;
  linkLabel?: string;
  /**
   * Short, urgent qualifier shown beside the title -- "DARURAT" on the urgent
   * rail, ported from kibi-clone's UrgentCampaigns.
   *
   * Uses --color-error, which is the only token that reads as urgency without
   * inventing a fifth semantic colour. White on it measures 6.54:1, which
   * clears AA for small text -- worth checking, because a 10px bold label is
   * exactly the size where a decorative red would fail.
   *
   * Deliberately a plain string, not a Snippet: this is a one-word status, and
   * a slot would invite putting a whole component in a 10px pill.
   */
  badge?: string;
}

const { title, href, linkLabel = "Lihat semua", badge }: Props = $props();
</script>

<div class="flex items-center justify-between gap-4">
  <div class="flex min-w-0 items-center gap-2">
    <h2 class="font-sans text-lg font-semibold text-neutral-900">{title}</h2>
    {#if badge}
      <span
        class="shrink-0 rounded-sm bg-error px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wide text-white"
      >
        {badge}
      </span>
    {/if}
  </div>
  {#if href}
    <a
      {href}
      class="shrink-0 font-sans text-sm font-medium text-primary transition-colors duration-150 hover:text-primary-dark hover:underline"
    >
      {linkLabel} &rsaquo;
    </a>
  {/if}
</div>
