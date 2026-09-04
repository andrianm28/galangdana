<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data, params }: PageProps = $props();

// biome-ignore lint/style/useConst: reassigned by the radio onchange handlers below
let type = $state<"partial" | "final">("partial");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let amountStr = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let narrative = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function proceed() {
  error = null;
  if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
    error = "Masukkan nominal yang valid.";
    return;
  }
  if (!narrative.trim()) {
    error = "Jelaskan penggunaan dana.";
    return;
  }
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const disbursementClient = (api.disbursements as any)({ id: params.disbursementId });

  // Re-establish the real response shape after the `any` cast above, matching
  // PATCH /disbursements/:id/detail's actual `response: { 200, 401, 404, 409, 422 }`
  // map in apps/api/src/routes/disbursements.ts.
  const { error: apiError } = (await disbursementClient.detail.patch({
    type,
    amountStr,
    narrative,
  })) as Treaty.TreatyResponse<{
    200: { success: boolean };
    401: { error: string };
    404: { error: string };
    409: { error: string };
    422: { error: string };
  }>;
  submitting = false;
  if (apiError) {
    if (apiError.status === 422 && apiError.value.error === "amount_exceeds_withdrawable_balance") {
      error = "Nominal melebihi saldo yang dapat dicairkan.";
      return;
    }
    error = "Gagal menyimpan detail pencairan.";
    return;
  }
  await goto(`/dashboard/campaigns/${params.id}/pencairan/${params.disbursementId}/otp`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-2 font-sans text-xl font-bold text-neutral-900">Detail Pencairan</h1>
  <p class="mb-6 font-sans text-sm text-neutral-600">
    Saldo dapat dicairkan: Rp{data.disbursement.withdrawableAmount.amount}
  </p>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <fieldset class="mb-4 space-y-2">
    <label class="flex items-center gap-2 font-sans text-sm">
      <input
        type="radio"
        name="type"
        checked={type === "partial"}
        onchange={() => (type = "partial")}
      />
      Pencairan Sebagian
    </label>
    <label class="flex items-center gap-2 font-sans text-sm">
      <input type="radio" name="type" checked={type === "final"} onchange={() => (type = "final")} />
      Pencairan Akhir
    </label>
  </fieldset>

  <FormField label="Nominal Pencairan" id="amount">
    <TextInput id="amount" bind:value={amountStr} inputmode="numeric" placeholder="1000000" />
  </FormField>

  <FormField label="Keterangan Penggunaan Dana" id="narrative">
    <textarea
      id="narrative"
      rows="4"
      class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
      bind:value={narrative}
      placeholder="Untuk biaya pengobatan..."
    ></textarea>
  </FormField>

  <Button onclick={proceed} disabled={submitting}>Lanjutkan</Button>
</div>
