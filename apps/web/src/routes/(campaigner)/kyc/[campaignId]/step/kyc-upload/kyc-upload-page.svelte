<script lang="ts">
import { goto, invalidateAll } from "$app/navigation";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import { nextKycStep, previousKycStep } from "../kyc-step-order";

interface Props {
  data: {
    kyc: { campaignId: string; ktpObjectKey: string | null; selfieObjectKey: string | null };
  };
  documentType: "ktp" | "selfie";
  stepName: string;
  heading: string;
}

const { data, documentType, stepName, heading }: Props = $props();

const alreadyUploaded = $derived(
  documentType === "ktp" ? data.kyc.ktpObjectKey : data.kyc.selfieObjectKey,
);

let selectedFile: File | null = $state(null);
let uploading = $state(false);
let error = $state<string | null>(null);

async function upload() {
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  error = null;
  uploading = true;

  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data: presign, error: presignError } = (await (api.campaigns as any)({
    id: data.kyc.campaignId,
  }).kyc.documents.presign.post({
    documentType,
    fileName: selectedFile.name,
  })) as Treaty.TreatyResponse<{
    // The cast above erases Eden's inference for this whole chain to `any` -- confining that
    // escape hatch to just the unresolvable overload, this re-establishes the real response
    // shape (matching this endpoint's actual `response: { 200, 401, 404, 422 }` map in
    // apps/api/src/routes/campaigns.ts) so `presign`/`presignError` are still checked against
    // the real PresignKycDocumentResponse / error shapes.
    200: { uploadUrl: string; objectKey: string; expiresInSeconds: number };
    401: { error: string };
    404: { error: string };
    422: { error: string };
  }>;
  if (presignError || !presign) {
    uploading = false;
    error = "Gagal menyiapkan unggahan. Periksa format file (jpg/jpeg/png).";
    return;
  }

  const putResp = await fetch(presign.uploadUrl, { method: "PUT", body: selectedFile });
  if (!putResp.ok) {
    uploading = false;
    error = "Gagal mengunggah file.";
    return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: confirmError } = (await (api.campaigns as any)({
    id: data.kyc.campaignId,
  }).kyc.documents.confirm.post({
    documentType,
    objectKey: presign.objectKey,
  })) as Treaty.TreatyResponse<{
    // Same narrowing as above, matching this endpoint's actual
    // `response: { 200, 400, 401, 404 }` map in apps/api/src/routes/campaigns.ts.
    200: { success: boolean };
    400: { error: string };
    401: { error: string };
    404: { error: string };
  }>;
  uploading = false;
  if (confirmError) {
    error = "Gagal menyimpan dokumen.";
    return;
  }

  selectedFile = null;
  await invalidateAll();
}

async function proceed(direction: "next" | "back") {
  const target = direction === "next" ? nextKycStep(stepName) : previousKycStep(stepName);
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">{heading}</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if alreadyUploaded}
    <p class="mb-4 font-sans text-sm text-neutral-600">Dokumen sudah diunggah.</p>
  {/if}

  <div class="mb-4">
    <label for="doc-file" class="mb-1 block font-sans text-sm font-medium text-neutral-900">File (jpg, jpeg, png)</label>
    <input
      id="doc-file"
      type="file"
      accept=".jpg,.jpeg,.png"
      onchange={(e) => (selectedFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
    />
  </div>

  <button
    type="button"
    onclick={upload}
    disabled={uploading}
    class="mb-6 rounded-sm border border-primary px-4 py-2 font-sans text-sm font-semibold text-primary disabled:opacity-50"
  >
    Unggah
  </button>

  <div class="flex justify-between">
    <button type="button" onclick={() => proceed("back")} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button type="button" onclick={() => proceed("next")} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark">Lanjutkan</button>
  </div>
</div>
