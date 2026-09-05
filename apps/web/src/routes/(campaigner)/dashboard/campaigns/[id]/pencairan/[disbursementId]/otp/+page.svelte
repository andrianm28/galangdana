<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { api } from "$lib/api-client";
import { Button, FormField, TextInput } from "@fundforindonesia/ui";

let sent = $state(false);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let code = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function requestCode() {
  error = null;
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const disbursementClient = (api.disbursements as any)({ id: page.params.disbursementId });
  const { error: apiError } = await disbursementClient.otp.request.post();
  submitting = false;
  if (apiError) {
    error =
      apiError.value?.error === "amount_exceeds_withdrawable_balance"
        ? "Saldo yang dapat dicairkan sudah tidak mencukupi untuk permintaan ini."
        : "Gagal mengirim kode OTP.";
    return;
  }
  sent = true;
}

async function verifyCode() {
  error = null;
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const disbursementClient = (api.disbursements as any)({ id: page.params.disbursementId });
  const { data, error: apiError } = await disbursementClient.otp.verify.post({ code });
  submitting = false;
  if (apiError || !data?.verified) {
    error = "Kode OTP salah atau kedaluwarsa.";
    return;
  }
  await goto(
    `/dashboard/campaigns/${page.params.id}/pencairan/${page.params.disbursementId}/summary`,
  );
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Konfirmasi OTP</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  {#if !sent}
    <p class="mb-4 font-sans text-sm text-neutral-600">
      Kami akan mengirimkan kode konfirmasi ke nomor telepon Anda.
    </p>
    <Button onclick={requestCode} disabled={submitting}>Kirim Kode</Button>
  {:else}
    <FormField label="Kode OTP" id="code">
      <TextInput id="code" bind:value={code} inputmode="numeric" placeholder="123456" />
    </FormField>
    <Button onclick={verifyCode} disabled={submitting}>Verifikasi</Button>
  {/if}
</div>
