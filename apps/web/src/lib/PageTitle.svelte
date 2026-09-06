<script lang="ts">
/**
 * Title (and noindex) for pages nobody should share or find in a search
 * engine: the checkout steps, a payment status. They still need a title --
 * a browser tab reading "fundforindonesia.org/search?q=jantng" is how a
 * donor loses their place among twenty tabs -- but a share card for a page
 * that means nothing to anyone except its owner is worse than none.
 *
 * Deliberately NOT a branch inside SeoHead. Adding {#if}/{:else} around
 * head content there made Svelte 5 throw "element.setAttribute is not a
 * function" on every page that used it, and SeoHead's current flat shape
 * is what a production link-preview bug bought. Two small components beat
 * one conditional one.
 */
interface Props {
  title: string;
}

const { title }: Props = $props();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="robots" content="noindex" />
</svelte:head>
