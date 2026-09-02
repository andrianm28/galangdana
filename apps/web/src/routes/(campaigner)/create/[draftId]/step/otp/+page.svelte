<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let stage: "request" | "verify" = $state("request");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let code = $state("");
let submitting = $state(false);
let error = $state<string | null>(null);

async function requestCode() {
  if (!data.phone) {
    error = "Nomor telepon tidak ditemukan pada akun Anda.";
    return;
  }
  error = null;
  submitting = true;
  const { error: apiError } = await api.auth.otp.request.post({ phone: data.phone });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim kode OTP.";
    return;
  }
  stage = "verify";
}

async function verifyAndProceed(direction: "next" | "back") {
  if (direction === "back") {
    const target = previousStep(data.draft.track, "otp");
    if (target) await goto(`/create/${data.draft.id}/step/${target}`);
    return;
  }
  if (!data.phone) return;
  error = null;
  submitting = true;
  const { error: verifyError } = await api.auth.otp.verify.post({ phone: data.phone, code });
  if (verifyError) {
    submitting = false;
    error = "Kode OTP salah atau kedaluwarsa.";
    return;
  }
  const { error: saveError } = await api["campaign-drafts"]({ id: data.draft.id }).answers.patch({
    step: "otp",
    answers: { otpConfirmedAt: new Date().toISOString() },
  });
  submitting = false;
  if (saveError) {
    error = "Gagal menyimpan konfirmasi.";
    return;
  }
  const target = nextStep(data.draft.track, "otp");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Konfirmasi Nomor Telepon</h2>
  <p class="mb-4 font-sans text-sm text-neutral-600">
    Untuk keamanan, konfirmasikan kembali nomor telepon terdaftar Anda: <strong>{data.phone}</strong>
  </p>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if stage === "request"}
    <button
      type="button"
      onclick={requestCode}
      disabled={submitting}
      class="mb-6 rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Kirim kode OTP
    </button>
  {:else}
    <div class="mb-6">
      <label for="otp-code" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kode OTP</label>
      <input id="otp-code" type="text" maxlength="6" bind:value={code} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base" />
    </div>
  {/if}

  <div class="flex justify-between">
    <button type="button" onclick={() => verifyAndProceed("back")} class="font-sans text-sm text-neutral-600">Kembali</button>
    {#if stage === "verify"}
      <button
        type="button"
        onclick={() => verifyAndProceed("next")}
        disabled={submitting}
        class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
      >
        Verifikasi &amp; Lanjutkan
      </button>
    {/if}
  </div>
</div>
