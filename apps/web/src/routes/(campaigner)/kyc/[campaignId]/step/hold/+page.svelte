<script lang="ts">
import { goto } from "$app/navigation";
import { nextKycStep } from "../kyc-step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

async function proceed() {
  const target = nextKycStep("hold");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Dokumen Diterima</h2>
  <p class="mb-6 font-sans text-sm text-neutral-600">
    Dokumen identitas Anda telah kami terima. Silakan lanjutkan untuk meninjau dan mengajukan
    campaign Anda untuk verifikasi.
  </p>
  <button type="button" onclick={proceed} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark">
    Lanjutkan
  </button>
</div>
