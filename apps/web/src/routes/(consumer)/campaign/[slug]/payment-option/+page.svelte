<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Button } from "@fundforindonesia/ui";

const amount = $derived(page.url.searchParams.get("amount") ?? "");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let selectedMethod = $state<"bank_transfer_va" | "qris_redirect">("bank_transfer_va");

function proceed() {
  goto(`/campaign/${page.params.slug}/contribute?amount=${amount}&paymentMethod=${selectedMethod}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Pilih Metode Pembayaran</h1>

  <fieldset class="mb-6 space-y-3">
    <label
      class="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-300 p-4"
    >
      <input
        type="radio"
        name="paymentMethod"
        value="bank_transfer_va"
        checked={selectedMethod === "bank_transfer_va"}
        onchange={() => (selectedMethod = "bank_transfer_va")}
      />
      <div>
        <p class="font-sans font-medium text-neutral-900">Transfer Bank (Virtual Account)</p>
        <p class="font-sans text-sm text-neutral-600">Bayar melalui transfer ke nomor VA.</p>
      </div>
    </label>

    <label
      class="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-300 p-4"
    >
      <input
        type="radio"
        name="paymentMethod"
        value="qris_redirect"
        checked={selectedMethod === "qris_redirect"}
        onchange={() => (selectedMethod = "qris_redirect")}
      />
      <div>
        <p class="font-sans font-medium text-neutral-900">QRIS</p>
        <p class="font-sans text-sm text-neutral-600">
          Scan QRIS melalui aplikasi bank atau e-wallet Anda.
        </p>
      </div>
    </label>
  </fieldset>

  <Button onclick={proceed}>Lanjutkan</Button>
</div>
