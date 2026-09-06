<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import PageTitle from "$lib/PageTitle.svelte";
import { formatMoney } from "@fundforindonesia/money";
import { Button } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const amount = $derived(page.url.searchParams.get("amount") ?? "");
// Never `Rp{amount}`. The raw query-string number has shipped to three
// different screens in this funnel already.
const amountLabel = $derived(
  /^\d+$/.test(amount) ? formatMoney({ amount: BigInt(amount), currency: "IDR" }) : "",
);

const METHODS = {
  bank_transfer_va: {
    label: "Transfer Bank (Virtual Account)",
    hint: "Bayar melalui transfer ke nomor VA.",
  },
  qris_redirect: {
    label: "QRIS",
    hint: "Scan QRIS melalui aplikasi bank atau e-wallet Anda.",
  },
} as const;

type Method = keyof typeof METHODS;

// Only what the server says it can actually complete. A method offered here
// and rejected at the next step is worse than one that was never offered.
const available = $derived(data.methods.filter((m): m is Method => m in METHODS));
let selectedMethod = $state<Method>("bank_transfer_va");
$effect(() => {
  if (available.length > 0 && !available.includes(selectedMethod)) {
    selectedMethod = available[0] as Method;
  }
});

function proceed() {
  goto(`/campaign/${page.params.slug}/contribute?amount=${amount}&paymentMethod=${selectedMethod}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Pilih Metode Pembayaran</h1>

  <p class="mb-4 font-sans text-sm text-neutral-600">
    Donasi <span class="font-semibold text-neutral-900 tabular-nums">{amountLabel}</span>
  </p>

  <fieldset class="mb-6 space-y-3">
    {#each available as method (method)}
      <label class="flex cursor-pointer items-center gap-3 rounded-md border border-neutral-300 p-4">
        <input
          type="radio"
          name="paymentMethod"
          value={method}
          checked={selectedMethod === method}
          onchange={() => (selectedMethod = method)}
        />
        <div>
          <p class="font-sans font-medium text-neutral-900">{METHODS[method].label}</p>
          <p class="font-sans text-sm text-neutral-600">{METHODS[method].hint}</p>
        </div>
      </label>
    {/each}
  </fieldset>

  <Button onclick={proceed}>Lanjutkan</Button>
</div>

<PageTitle title="Pilih metode pembayaran" />
