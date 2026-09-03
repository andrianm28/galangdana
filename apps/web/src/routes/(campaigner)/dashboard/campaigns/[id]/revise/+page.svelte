<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import type {
  PresignCampaignDocumentResponse,
  SubmitCampaignResponse,
} from "@galangdana/contracts";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// GET /campaigns/:id/revisions is internally routed with a ":slug" param
// name at this trie position (see +page.server.ts), which merges into
// Eden's generated `campaigns({...})` call signature as `{ id, slug }`
// both required, for every route under this prefix -- including the
// story/goal-amount/documents/submit routes actually used below, which
// each have their own, unambiguous ":id" param. Same established
// merged-param-name cast as +page.server.ts and
// (admin)/campaigns/[id]/+page.server.ts, centralized here since every
// action on this page needs it.
// biome-ignore lint/suspicious/noExplicitAny: Eden merged-param-name cast
function campaignClient(id: string): any {
  // biome-ignore lint/suspicious/noExplicitAny: Eden merged-param-name cast
  return (api.campaigns as any)({ id });
}

const FIELD_LABELS: Record<string, string> = {
  cerita: "Cerita",
  target_donasi: "Target Donasi",
  kartu_mahasiswa: "Kartu Mahasiswa",
  kartu_pelajar: "Kartu Pelajar",
  tagihan_rumah_sakit: "Tagihan Rumah Sakit",
  tagihan_institusi_pendidikan: "Tagihan Institusi Pendidikan",
  media_sosial: "Media Sosial",
  sumber_gambar: "Sumber Gambar",
};

const DOCUMENT_FIELDS = new Set([
  "kartu_mahasiswa",
  "kartu_pelajar",
  "tagihan_rumah_sakit",
  "tagihan_institusi_pendidikan",
  "media_sosial",
  "sumber_gambar",
]);

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let storyValue = $state(data.story);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let goalAmountValue = $state(data.goalAmount?.amount ?? "");
let saving = $state<string | null>(null);
let submitting = $state(false);
let error = $state<string | null>(null);
const selectedFiles = $state<Record<string, File | null>>({});
let savedField = $state<string | null>(null);

async function saveStory() {
  if (!storyValue.trim()) {
    error = "Cerita tidak boleh kosong.";
    return;
  }
  saving = "cerita";
  error = null;
  savedField = null;
  // The campaignClient() cast above erases this whole chain to `any` --
  // re-establish the real response shape (matching PUT /campaigns/:id/story's
  // actual `response: { 200, 401, 404, 409 }` map in apps/api/src/routes/campaigns.ts)
  // so `apiError` is still checked against the real error shape.
  const { error: apiError } = (await campaignClient(data.campaignId).story.put({
    story: storyValue,
  })) as Treaty.TreatyResponse<{
    200: { success: boolean };
    401: { error: string };
    404: { error: string };
    409: { error: string };
  }>;
  saving = null;
  if (apiError) {
    error = "Gagal menyimpan cerita.";
    return;
  }
  savedField = "cerita";
}

async function saveGoalAmount() {
  if (!/^\d+$/.test(goalAmountValue)) {
    error = "Masukkan angka target donasi yang valid.";
    return;
  }
  saving = "target_donasi";
  error = null;
  savedField = null;
  // Same narrowing as saveStory(), matching PUT /campaigns/:id/goal-amount's
  // actual `response: { 200, 401, 404, 409 }` map.
  const { error: apiError } = (await campaignClient(data.campaignId)["goal-amount"].put({
    goalAmountStr: goalAmountValue,
  })) as Treaty.TreatyResponse<{
    200: { success: boolean };
    401: { error: string };
    404: { error: string };
    409: { error: string };
  }>;
  saving = null;
  if (apiError) {
    error = "Gagal menyimpan target donasi.";
    return;
  }
  savedField = "target_donasi";
}

async function uploadDocument(documentType: string) {
  const selectedFile = selectedFiles[documentType];
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  saving = documentType;
  error = null;
  savedField = null;

  // Same narrowing as saveStory(), matching POST /campaigns/:id/documents/presign's
  // actual `response: { 200, 401, 404, 409, 422 }` map, so `presign`/`presignError`
  // are checked against the real PresignCampaignDocumentResponse / error shapes.
  const { data: presign, error: presignError } = (await campaignClient(
    data.campaignId,
  ).documents.presign.post({
    documentType,
    fileName: selectedFile.name,
  })) as Treaty.TreatyResponse<{
    200: PresignCampaignDocumentResponse;
    401: { error: string };
    404: { error: string };
    409: { error: string };
    422: { error: string };
  }>;
  if (presignError || !presign) {
    saving = null;
    error = "Gagal menyiapkan unggahan.";
    return;
  }

  const putResp = await fetch(presign.uploadUrl, { method: "PUT", body: selectedFile });
  if (!putResp.ok) {
    saving = null;
    error = "Gagal mengunggah file.";
    return;
  }

  // Same narrowing as saveStory(), matching POST /campaigns/:id/documents/confirm's
  // actual `response: { 200, 400, 401, 404, 409 }` map.
  const { error: confirmError } = (await campaignClient(data.campaignId).documents.confirm.post({
    documentType,
    objectKey: presign.objectKey,
  })) as Treaty.TreatyResponse<{
    200: { success: boolean };
    400: { error: string };
    401: { error: string };
    404: { error: string };
    409: { error: string };
  }>;
  saving = null;
  if (confirmError) {
    error = "Gagal menyimpan dokumen.";
    return;
  }
  selectedFiles[documentType] = null;
  savedField = documentType;
}

async function resubmit() {
  error = null;
  submitting = true;
  // Same narrowing as saveStory(), matching POST /campaigns/:id/submit's
  // actual `response: { 200, 400, 401, 404, 409 }` map.
  const { error: apiError } = (await campaignClient(
    data.campaignId,
  ).submit.post()) as Treaty.TreatyResponse<{
    200: SubmitCampaignResponse;
    400: { error: string };
    401: { error: string };
    404: { error: string };
    409: { error: string };
  }>;
  submitting = false;
  if (apiError) {
    error = "Gagal mengajukan ulang campaign.";
    return;
  }
  await goto("/dashboard/campaigns");
}
</script>

<div class="mx-auto max-w-2xl px-4 py-6">
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Perbaiki Campaign</h2>

  {#if error}
    <p class="mb-4 font-sans text-sm text-error">{error}</p>
  {/if}

  {#each data.revisions as revision (revision.id)}
    <div class="mb-6 rounded-sm border border-neutral-200 p-4">
      <h3 class="mb-1 font-sans text-sm font-semibold text-neutral-900">
        {FIELD_LABELS[revision.field] ?? revision.field}
      </h3>
      <p class="mb-3 font-sans text-sm text-neutral-600">{revision.note}</p>

      {#if revision.field === "cerita"}
        <label for="story-input" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
          Cerita baru
        </label>
        <textarea
          id="story-input"
          rows="4"
          class="mb-2 w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
          bind:value={storyValue}
        ></textarea>
        <button
          type="button"
          onclick={saveStory}
          disabled={saving === "cerita"}
          class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white disabled:opacity-50"
        >
          Simpan Cerita
        </button>
        {#if savedField === "cerita"}
          <span class="ml-2 font-sans text-xs font-medium text-success">Tersimpan</span>
        {/if}
      {:else if revision.field === "target_donasi"}
        <label for="goal-input" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
          Target donasi baru (Rp)
        </label>
        <input
          id="goal-input"
          type="text"
          inputmode="numeric"
          class="mb-2 w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
          bind:value={goalAmountValue}
        />
        <button
          type="button"
          onclick={saveGoalAmount}
          disabled={saving === "target_donasi"}
          class="rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white disabled:opacity-50"
        >
          Simpan Target
        </button>
        {#if savedField === "target_donasi"}
          <span class="ml-2 font-sans text-xs font-medium text-success">Tersimpan</span>
        {/if}
      {:else if DOCUMENT_FIELDS.has(revision.field)}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onchange={(e) =>
            (selectedFiles[revision.field] = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
        />
        <button
          type="button"
          onclick={() => uploadDocument(revision.field)}
          disabled={saving === revision.field}
          class="ml-2 rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white disabled:opacity-50"
        >
          Unggah
        </button>
        {#if savedField === revision.field}
          <span class="ml-2 font-sans text-xs font-medium text-success">Tersimpan</span>
        {/if}
      {/if}
    </div>
  {/each}

  <button
    type="button"
    onclick={resubmit}
    disabled={submitting}
    class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
  >
    Ajukan Ulang
  </button>
</div>
