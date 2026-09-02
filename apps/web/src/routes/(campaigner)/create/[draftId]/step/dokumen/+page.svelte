<script lang="ts">
import { goto, invalidateAll } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";
import { getDocumentTypes } from "./document-types";

const { data }: PageProps = $props();

const documentTypes = getDocumentTypes(data.draft.track);
// Types with a document already uploaded are dropped from the selectable
// list -- otherwise picking one of them here would look identical to (and,
// in the DOM, literally collide with) that type's own already-uploaded
// list entry below.
const uploadedTypes = new Set(data.draft.documents.map((doc) => doc.type));
const availableTypes = documentTypes.filter((t) => !uploadedTypes.has(t.value));

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let selectedType = $state(availableTypes[0]?.value ?? documentTypes[0]?.value ?? "riwayat_medis");
let selectedFile: File | null = $state(null);
let uploading = $state(false);
let error = $state<string | null>(null);

function typeLabel(value: string): string {
  return documentTypes.find((t) => t.value === value)?.label ?? value;
}

async function uploadDocument() {
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  error = null;
  uploading = true;

  const { data: presign, error: presignError } = await api["campaign-drafts"]({
    id: data.draft.id,
  }).documents.presign.post({ type: selectedType, fileName: selectedFile.name });

  // The plain `!presign` check narrows out `null`, but Eden Treaty's
  // inferred type for `presign` here is a union that also carries the
  // 401/404/422 error schemas (see apps/web/src/routes/(consumer)/campaign/
  // [slug]/+page.ts for the same pattern), so `presign.uploadUrl` doesn't
  // type-check as a definite `string` without also excluding those via
  // `"error" in presign`.
  if (presignError || !presign || "error" in presign) {
    uploading = false;
    error = "Gagal menyiapkan unggahan. Periksa format file (pdf/jpg/jpeg/png).";
    return;
  }

  const putResp = await fetch(presign.uploadUrl, { method: "PUT", body: selectedFile });
  if (!putResp.ok) {
    uploading = false;
    error = "Gagal mengunggah file.";
    return;
  }

  const { error: confirmError } = await api["campaign-drafts"]({
    id: data.draft.id,
  }).documents.post({
    type: selectedType,
    objectKey: presign.objectKey,
  });
  uploading = false;
  if (confirmError) {
    error = "Gagal menyimpan dokumen.";
    return;
  }

  selectedFile = null;
  await invalidateAll();
}

async function proceed(direction: "next" | "back") {
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "dokumen")
      : previousStep(data.draft.track, "dokumen");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Dokumen Pendukung</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if data.draft.documents.length > 0}
    <ul class="mb-4 space-y-1 font-sans text-sm text-neutral-600">
      {#each data.draft.documents as doc (doc.id)}
        <li>{typeLabel(doc.type)} — diunggah {new Date(doc.uploadedAt).toLocaleDateString("id-ID")}</li>
      {/each}
    </ul>
  {/if}

  <div class="mb-4">
    <label for="doc-type" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Jenis dokumen</label>
    <select id="doc-type" bind:value={selectedType} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm">
      {#each availableTypes as t (t.value)}
        <option value={t.value}>{t.label}</option>
      {/each}
    </select>
  </div>

  <div class="mb-4">
    <label for="doc-file" class="mb-1 block font-sans text-sm font-medium text-neutral-900">File (pdf, jpg, jpeg, png)</label>
    <input
      id="doc-file"
      type="file"
      accept=".pdf,.jpg,.jpeg,.png"
      onchange={(e) => (selectedFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
    />
  </div>

  <button
    type="button"
    onclick={uploadDocument}
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
