<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<main>
  <h1>GalangDana</h1>
  <p>API status: <strong>{data.apiStatus}</strong> ({data.apiService})</p>
</main>
