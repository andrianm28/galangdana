<script lang="ts">
import { goto } from "$app/navigation";
import { nextKycStep } from "../kyc-step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const bothDocumentsUploaded = $derived(
  Boolean(data.kyc.ktpObjectKey) && Boolean(data.kyc.selfieObjectKey),
);

async function proceed() {
  const target = nextKycStep("hold");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Dokumen Diterima</h2>
  {#if bothDocumentsUploaded}
    <p class="mb-6 font-sans text-sm text-neutral-600">
      Dokumen identitas Anda telah kami terima. Silakan lanjutkan untuk meninjau dan mengajukan
      campaign Anda untuk verifikasi.
    </p>
  {:else}
    <p class="mb-6 font-sans text-sm text-neutral-600">
      Dokumen identitas Anda belum lengkap. Silakan kembali ke langkah unggah dokumen untuk
      melengkapi {!data.kyc.ktpObjectKey && !data.kyc.selfieObjectKey
        ? "foto KTP dan foto selfie"
        : !data.kyc.ktpObjectKey
          ? "foto KTP"
          : "foto selfie"} sebelum melanjutkan.
    </p>
  {/if}
  <button type="button" onclick={proceed} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark">
    Lanjutkan
  </button>
</div>
