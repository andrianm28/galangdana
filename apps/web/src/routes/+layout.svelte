<script lang="ts">
import "../app.css";

const { children } = $props();
</script>

<svelte:head>
  <!--
    Fonts only. Link-preview metadata is emitted by lib/SeoHead.svelte, once per
    page. It used to live here as a site-wide default, on the assumption that a
    page's own og: tags would override it -- they do not. Svelte does not
    deduplicate head elements, both sets rendered, and the generic ones came
    first, which is the occurrence scrapers take.
  -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=JetBrains+Mono:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
