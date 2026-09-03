<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { params }: PageProps = $props();

let file = $state<File | null>(null);
let uploaded = $state(false);
let error = $state<string | null>(null);
let uploading = $state(false);

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  file = input.files?.[0] ?? null;
  uploaded = false;
  error = null;
}

async function upload() {
  if (!file) return;
  error = null;
  uploading = true;

  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const disbursementClient = (api.disbursements as any)({ id: params.disbursementId });

  // Re-establish the real response shape after the `any` cast above, matching
  // POST /disbursements/:id/proof/presign's actual
  // `response: { 200, 401, 404, 409, 422 }` map in apps/api/src/routes/disbursements.ts.
  const { data: presign, error: presignError } = (await disbursementClient.proof.presign.post({
    fileName: file.name,
  })) as Treaty.TreatyResponse<{
    200: { uploadUrl: string; objectKey: string; expiresInSeconds: number };
    401: { error: string };
    404: { error: string };
    409: { error: string };
    422: { error: string };
  }>;
  if (presignError || !presign) {
    error = "Gagal menyiapkan unggahan.";
    uploading = false;
    return;
  }

  const putRes = await fetch(presign.uploadUrl, { method: "PUT", body: file });
  if (!putRes.ok) {
    error = "Gagal mengunggah berkas.";
    uploading = false;
    return;
  }

  // Same narrowing as above, matching POST /disbursements/:id/proof/confirm's
  // actual `response: { 200, 400, 401, 404, 409 }` map.
  const { error: confirmError } = (await disbursementClient.proof.confirm.post({
    objectKey: presign.objectKey,
  })) as Treaty.TreatyResponse<{
    200: { success: boolean };
    400: { error: string };
    401: { error: string };
    404: { error: string };
    409: { error: string };
  }>;
  uploading = false;
  if (confirmError) {
    error = "Gagal menyimpan berkas.";
    return;
  }
  uploaded = true;
}

async function proceed() {
  if (!uploaded) {
    error = "Unggah bukti kebutuhan dana terlebih dahulu.";
    return;
  }
  await goto(`/dashboard/campaigns/${params.id}/pencairan/${params.disbursementId}/detail`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Bukti Kebutuhan Dana</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onchange={onFileChange} class="mb-2" />

  {#if file}
    <p class="mb-4 font-sans text-sm text-neutral-600">{file.name}</p>
  {/if}

  {#if file && !uploaded}
    <div class="mb-4">
      <Button onclick={upload} disabled={uploading}>Unggah</Button>
    </div>
  {/if}
  {#if uploaded}
    <p class="mb-4 font-sans text-sm text-green-700">Berkas berhasil diunggah.</p>
  {/if}

  <Button onclick={proceed} disabled={!uploaded}>Lanjutkan</Button>
</div>
