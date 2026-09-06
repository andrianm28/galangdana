<script lang="ts">
import { goto } from "$app/navigation";
import {
  MAX_DONATION_RUPIAH,
  MIN_DONATION_RUPIAH,
  validateDonationAmount,
} from "@fundforindonesia/contracts";
import { formatMoney } from "@fundforindonesia/money";
import { Button, FormField, TextInput } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data, params }: PageProps = $props();

// Round, mentally legible, and re-derivable. Deliberately NOT copied from the
// incumbent's ladder, whose odd Rp 95.000 rung is almost certainly A/B-derived
// -- copying a number whose derivation you do not have is cargo cult.
//
// None is preselected. A pre-filled amount is a nudge, and this product does
// not get to make one on the screen where the donor decides what to give.
const PRESETS = [25_000n, 50_000n, 100_000n, 250_000n];

let amountStr = $state("");
let error = $state<string | null>(null);

const ERRORS: Record<string, string> = {
  amount_invalid: "Masukkan nominal dalam angka, tanpa titik atau koma.",
  amount_below_minimum: `Nominal minimum ${formatMoney({ amount: MIN_DONATION_RUPIAH, currency: "IDR" })}.`,
  amount_above_maximum: `Untuk donasi di atas ${formatMoney({ amount: MAX_DONATION_RUPIAH, currency: "IDR" })}, hubungi kami lebih dulu.`,
};

function choose(preset: bigint) {
  amountStr = preset.toString();
  error = null;
}

function proceed() {
  const result = validateDonationAmount(amountStr);
  if (!result.ok) {
    error = ERRORS[result.error] ?? "Masukkan nominal donasi yang valid.";
    return;
  }
  error = null;
  goto(`/campaign/${params.slug}/payment-option?amount=${amountStr}`);
}
</script>

<div class="mx-auto flex max-w-md flex-col gap-6 py-8">
  <div>
    <p class="font-sans text-sm text-neutral-600">Donasi untuk</p>
    <h1 class="font-sans text-lg font-bold text-neutral-900">{data.campaign.title}</h1>
  </div>

  <div>
    <p class="mb-2 font-sans text-sm font-medium text-neutral-900">Pilih nominal</p>
    <div class="grid grid-cols-2 gap-2">
      {#each PRESETS as preset (preset)}
        <button
          type="button"
          onclick={() => choose(preset)}
          aria-pressed={amountStr === preset.toString()}
          class="rounded-md border px-4 py-3 text-center font-sans text-sm font-semibold transition-colors {amountStr ===
          preset.toString()
            ? 'border-primary bg-primary/5 text-primary-dark'
            : 'border-neutral-200 bg-white text-neutral-900 hover:border-neutral-300'}"
        >
          {formatMoney({ amount: preset, currency: "IDR" })}
        </button>
      {/each}
    </div>
  </div>

  <FormField label="Atau masukkan nominal lain" id="amount">
    <TextInput
      id="amount"
      bind:value={amountStr}
      inputmode="numeric"
      placeholder={MIN_DONATION_RUPIAH.toString()}
    />
  </FormField>

  {#if error}
    <p class="font-sans text-sm font-medium text-red-700" role="alert">{error}</p>
  {/if}

  <div class="flex flex-col gap-2">
    <Button onclick={proceed}>Lanjutkan</Button>
    <p class="font-sans text-xs text-neutral-500">
      Minimum {formatMoney({ amount: MIN_DONATION_RUPIAH, currency: "IDR" })}. Dana tidak kami
      cairkan sebelum buktinya ada.
    </p>
  </div>
</div>
