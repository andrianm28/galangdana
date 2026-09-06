<script lang="ts">
import ErrorPage from "$lib/ErrorPage.svelte";
import { ConsumerShell } from "@fundforindonesia/ui";

// A URL that matches no route at all lands outside every route group, so no
// group layout applies and the shell has to be added here. Errors *inside*
// (consumer) are caught by that group's own +error.svelte, which is already
// wrapped -- wrapping twice would render two headers.
</script>

<ConsumerShell>
  <ErrorPage />
</ConsumerShell>
