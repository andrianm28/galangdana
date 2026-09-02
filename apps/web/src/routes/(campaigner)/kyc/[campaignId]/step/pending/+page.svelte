<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Menunggu Peninjauan</h2>
  <p class="font-sans text-sm text-neutral-600">
    Campaign <strong>{data.kyc.campaignTitle}</strong> sedang menunggu peninjauan tim kami. Anda akan
    diberi tahu setelah proses peninjauan selesai.
  </p>
</div>
