<script lang="ts">
import "../app.css";

const { children } = $props();
</script>

<svelte:head>
  <!--
    Site-wide link-preview defaults. app.html carried no og: tags at all, so
    every forwarded fundforindonesia.org link rendered as a bare grey URL chip
    -- on a product whose traffic moves through WhatsApp forwards. Individual
    pages override title/description/image; these are the floor, not the
    ceiling, and a page that sets its own simply wins.
  -->
  <title>FundForIndonesia</title>
  <meta name="description" content="Galang dan salurkan donasi, dengan jejak dana yang bisa diperiksa." />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="FundForIndonesia" />
  <meta property="og:locale" content="id_ID" />
  <meta property="og:title" content="FundForIndonesia" />
  <meta
    property="og:description"
    content="Galang dan salurkan donasi, dengan jejak dana yang bisa diperiksa."
  />
  <meta name="twitter:card" content="summary" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
