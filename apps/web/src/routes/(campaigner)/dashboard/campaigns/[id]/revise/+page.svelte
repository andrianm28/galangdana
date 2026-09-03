<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
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
let storyValue = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let goalAmountValue = $state("");
let saving = $state<string | null>(null);
let submitting = $state(false);
let error = $state<string | null>(null);
let selectedFile = $state<File | null>(null);

async function saveStory() {
  if (!storyValue.trim()) return;
  saving = "cerita";
  error = null;
  const { error: apiError } = await campaignClient(data.campaignId).story.put({
    story: storyValue,
  });
  saving = null;
  if (apiError) error = "Gagal menyimpan cerita.";
}

async function saveGoalAmount() {
  if (!/^\d+$/.test(goalAmountValue)) {
    error = "Masukkan angka target donasi yang valid.";
    return;
  }
  saving = "target_donasi";
  error = null;
  const { error: apiError } = await campaignClient(data.campaignId)["goal-amount"].put({
    goalAmountStr: goalAmountValue,
  });
  saving = null;
  if (apiError) error = "Gagal menyimpan target donasi.";
}

async function uploadDocument(documentType: string) {
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  saving = documentType;
  error = null;

  const { data: presign, error: presignError } = await campaignClient(
    data.campaignId,
  ).documents.presign.post({ documentType, fileName: selectedFile.name });
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

  const { error: confirmError } = await campaignClient(data.campaignId).documents.confirm.post({
    documentType,
    objectKey: presign.objectKey,
  });
  saving = null;
  if (confirmError) {
    error = "Gagal menyimpan dokumen.";
    return;
  }
  selectedFile = null;
}

async function resubmit() {
  error = null;
  submitting = true;
  const { error: apiError } = await campaignClient(data.campaignId).submit.post();
  submitting = false;
  if (apiError) {
    error = "Gagal mengajukan ulang campaign.";
    return;
  }
  await goto("/dashboard");
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
      {:else if DOCUMENT_FIELDS.has(revision.field)}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onchange={(e) => (selectedFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
        />
        <button
          type="button"
          onclick={() => uploadDocument(revision.field)}
          disabled={saving === revision.field}
          class="ml-2 rounded-sm bg-primary px-3 py-1.5 font-sans text-xs font-semibold text-white disabled:opacity-50"
        >
          Unggah
        </button>
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
