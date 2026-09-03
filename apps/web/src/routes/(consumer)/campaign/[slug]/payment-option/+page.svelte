<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Button } from "@galangdana/ui";

const amount = $derived(page.url.searchParams.get("amount") ?? "");

function proceed() {
  goto(`/campaign/${page.params.slug}/contribute?amount=${amount}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Pilih Metode Pembayaran</h1>

  <div class="mb-6 rounded-md border border-neutral-300 p-4">
    <p class="font-sans font-medium text-neutral-900">Transfer Bank (Virtual Account)</p>
    <p class="font-sans text-sm text-neutral-600">Metode pembayaran lain akan segera tersedia.</p>
  </div>

  <Button onclick={proceed}>Lanjutkan</Button>
</div>
