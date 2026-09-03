<script lang="ts">
import { goto } from "$app/navigation";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data, params }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let amountStr = $state("");
let error = $state<string | null>(null);

function proceed() {
  error = null;
  if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
    error = "Masukkan nominal donasi yang valid.";
    return;
  }
  goto(`/campaign/${params.slug}/payment-option?amount=${amountStr}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">{data.campaign.title}</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <FormField label="Nominal donasi" id="amount">
    <TextInput id="amount" bind:value={amountStr} inputmode="numeric" placeholder="50000" />
  </FormField>

  <Button onclick={proceed}>Lanjutkan</Button>
</div>
