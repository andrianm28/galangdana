<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import { previousKycStep } from "../kyc-step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let submitting = $state(false);
let error = $state<string | null>(null);

async function back() {
  const target = previousKycStep("summary");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}

async function submitCampaign() {
  error = null;
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: apiError } = (await (api.campaigns as any)({
    id: data.kyc.campaignId,
  }).submit.post()) as Treaty.TreatyResponse<{
    // The cast above erases Eden's inference for this whole chain to `any` -- confining that
    // escape hatch to just the unresolvable overload, this re-establishes the real response
    // shape (matching this endpoint's actual `response: { 200, 400, 401, 404 }` map in
    // apps/api/src/routes/campaigns.ts) so `apiError` is still checked against the real
    // SubmitCampaignResponse / error shapes.
    200: { status: string };
    400: { error: string };
    401: { error: string };
    404: { error: string };
  }>;
  submitting = false;
  if (apiError) {
    error = "Gagal mengajukan campaign. Pastikan dokumen KTP dan selfie sudah diunggah.";
    return;
  }
  await goto(`/kyc/${data.kyc.campaignId}/step/pending`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Ringkasan Verifikasi</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <dl class="mb-6 space-y-4 font-sans text-sm">
    <div>
      <dt class="font-medium text-neutral-900">Nama lengkap</dt>
      <dd class="text-neutral-600">{data.kyc.fullName}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">NIK</dt>
      <dd class="text-neutral-600">{data.kyc.nationalId}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">Tanggal lahir</dt>
      <dd class="text-neutral-600">{data.kyc.dateOfBirth}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">Alamat</dt>
      <dd class="text-neutral-600">{data.kyc.address}, <span>{data.kyc.city}</span> {data.kyc.postalCode}</dd>
    </div>
    <div>
      <dt class="font-medium text-neutral-900">Dokumen</dt>
      <dd class="text-neutral-600">
        KTP: {data.kyc.ktpObjectKey ? "sudah diunggah" : "belum diunggah"} ·
        Selfie: {data.kyc.selfieObjectKey ? "sudah diunggah" : "belum diunggah"}
      </dd>
    </div>
  </dl>

  <div class="flex justify-between">
    <button type="button" onclick={back} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button
      type="button"
      onclick={submitCampaign}
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Ajukan Campaign
    </button>
  </div>
</div>
