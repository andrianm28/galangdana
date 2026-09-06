<script lang="ts">
/**
 * The single place link-preview metadata is emitted.
 *
 * This exists because the first attempt put site-wide og: defaults in the root
 * layout and page-specific ones on the page, assuming the more specific tag
 * would win. It does not. Svelte does not deduplicate arbitrary <svelte:head>
 * elements, so both sets rendered, the generic pair came FIRST in document
 * order, and scrapers that take the first occurrence -- Facebook's and
 * therefore WhatsApp's among them -- showed "FundForIndonesia" on every
 * forwarded campaign link instead of the campaign's own title. Verified in the
 * live HTML: two og:title tags, generic one first.
 *
 * So there is exactly one emitter, every page passes its own values, and
 * nothing is inherited. A page that forgets to use it gets no preview at all,
 * which is a visible absence rather than a silently wrong card.
 */
interface Props {
  title: string;
  description: string;
  /** Absolute. A relative URL is resolved by the scraper, not the browser. */
  url?: string;
  /** Absolute, or null when there is no image -- which downgrades the card. */
  image?: string | null;
  imageAlt?: string;
}

const { title, description, url, image = null, imageAlt }: Props = $props();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  {#if url}
    <link rel="canonical" href={url} />
    <meta property="og:url" content={url} />
  {/if}

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="FundForIndonesia" />
  <meta property="og:locale" content="id_ID" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />

  {#if image}
    <meta property="og:image" content={image} />
    <meta property="og:image:alt" content={imageAlt ?? title} />
    <meta name="twitter:card" content="summary_large_image" />
  {:else}
    <meta name="twitter:card" content="summary" />
  {/if}
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
</svelte:head>
