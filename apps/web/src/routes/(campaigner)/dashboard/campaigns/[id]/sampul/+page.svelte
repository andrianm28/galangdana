<script lang="ts">
import CoverUpload from "$lib/CoverUpload.svelte";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import type { PresignCoverUploadResponse } from "@fundforindonesia/contracts";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// Mirrors the API's cover-editability rule (apps/api/src/routes/campaigns.ts):
// cosmetic change allowed everywhere except under moderation or terminal.
// The API enforces this regardless; this only decides what the page shows.
const COVER_EDITABLE = new Set(["draft", "needs_revision", "active", "paused", "completed"]);
const editable = $derived(COVER_EDITABLE.has(data.status));

let saved = $state(false);

// biome-ignore lint/suspicious/noExplicitAny: Eden merged-param-name cast, same as revise page
function campaignClient(id: string): any {
  // biome-ignore lint/suspicious/noExplicitAny: Eden merged-param-name cast
  return (api.campaigns as any)({ id });
}

async function presignCover(fileName: string) {
  const { data: presign, error: apiError } = (await campaignClient(
    data.campaignId,
  ).cover.presign.post({ fileName })) as Treaty.TreatyResponse<{
    200: PresignCoverUploadResponse;
    401: { error: string };
    404: { error: string };
    409: { error: string };
    422: { error: string };
  }>;
  if (apiError || !presign || "error" in presign) return null;
  return { uploadUrl: presign.uploadUrl, objectKey: presign.objectKey };
}

async function confirmCover(objectKey: string): Promise<string | null> {
  const { error: apiError } = (await campaignClient(data.campaignId).cover.confirm.post({
    objectKey,
  })) as Treaty.TreatyResponse<{
    200: { success: boolean };
    400: { error: string };
    401: { error: string };
    404: { error: string };
    409: { error: string };
    422: { error: string };
  }>;
  if (apiError) {
    return apiError.status === 409
      ? "Sampul tidak dapat diubah pada status ini."
      : "Gagal menyimpan sampul. Silakan coba lagi.";
  }
  saved = true;
  return null;
}
</script>

<div class="mx-auto max-w-md px-4 py-12">
  <h1 class="mb-2 font-sans text-xl font-bold text-neutral-900">Foto Sampul</h1>
  <p class="mb-6 font-sans text-sm text-neutral-600">{data.title}</p>

  {#if editable}
    <CoverUpload presign={presignCover} confirm={confirmCover} />
    {#if saved}
      <p class="mt-3 font-sans text-sm font-medium text-success">Sampul baru tersimpan.</p>
    {/if}
  {:else}
    <p class="font-sans text-sm text-neutral-600">
      Sampul tidak dapat diubah selama campaign ditinjau atau ditolak.
    </p>
  {/if}

  <a href="/dashboard/campaigns" class="mt-6 inline-block font-sans text-sm text-neutral-600">
    Kembali ke campaign saya
  </a>
</div>
