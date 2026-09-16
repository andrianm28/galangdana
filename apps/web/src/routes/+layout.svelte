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
  <!--
    Rubik replaces Plus Jakarta Sans (see theme.css's --font-sans).

    Only the weights actually used are requested. The previous URL asked for
    Plus Jakarta Sans as TWO variable axes across 200..800 including a full
    italic range -- on every page load -- while the codebase uses exactly four
    weights and never italicises sans text:

      font-medium   80 uses   -> 500
      font-semibold 99 uses   -> 600
      font-bold     38 uses   -> 700
      font-normal    1 use    -> 400

    Newsreader keeps its italic axis: the one `italic` in the whole app is on a
    font-serif element (the terbilang line on the kuitansi), so dropping it
    would silently fall back to a synthesised oblique.
  -->
  <link
    href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Rubik:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
