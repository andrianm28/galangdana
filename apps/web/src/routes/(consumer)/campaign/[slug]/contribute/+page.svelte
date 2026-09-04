<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { api } from "$lib/api-client";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const amount = $derived(page.url.searchParams.get("amount") ?? "");
const paymentMethod = $derived(
  (page.url.searchParams.get("paymentMethod") ?? "bank_transfer_va") as
    | "bank_transfer_va"
    | "qris_redirect",
);
let submitting = $state(false);
let error = $state<string | null>(null);

async function confirm() {
  error = null;
  submitting = true;
  const { data: responseData, error: apiError } = await api.donations.post(
    { campaignId: data.campaign.id, amountStr: amount, paymentMethod },
    { headers: { "idempotency-key": crypto.randomUUID() } },
  );
  submitting = false;
  if (apiError || !responseData || "error" in responseData) {
    error = "Gagal memproses donasi. Silakan coba lagi.";
    return;
  }
  if (responseData.method === "qris_redirect" && responseData.redirectUrl) {
    window.location.href = responseData.redirectUrl;
    return;
  }
  await goto(`/donation/status/${responseData.donationId}`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Konfirmasi Donasi</h1>

  <p class="mb-6 font-sans text-neutral-700">Nominal: Rp{amount}</p>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <Button onclick={confirm} disabled={submitting}>Konfirmasi Donasi</Button>
</div>
