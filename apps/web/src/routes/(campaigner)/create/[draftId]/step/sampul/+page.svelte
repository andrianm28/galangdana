<script lang="ts">
import { goto } from "$app/navigation";
import CoverUpload from "$lib/CoverUpload.svelte";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";

const STEP = "sampul";

const { data }: PageProps = $props();

// A returning visitor sees their saved state, not a blank uploader: the
// key was persisted into answers at confirm time, so it survives reloads.
let uploadedKey = $state<string | null>(
  typeof data.draft.answers.coverObjectKey === "string"
    ? (data.draft.answers.coverObjectKey as string)
    : null,
);
let error: string | null = $state(null);

async function presignCover(fileName: string) {
  const { data: presign, error: apiError } = await api["campaign-drafts"]({
    id: data.draft.id,
  }).cover.presign.post({ fileName });
  if (apiError || !presign || "error" in presign) return null;
  return { uploadUrl: presign.uploadUrl, objectKey: presign.objectKey };
}

async function confirmCover(objectKey: string): Promise<string | null> {
  const { error: apiError } = await api["campaign-drafts"]({
    id: data.draft.id,
  }).answers.patch({ step: STEP, answers: { coverObjectKey: objectKey } });
  if (apiError) return "Gagal menyimpan sampul. Silakan coba lagi.";
  uploadedKey = objectKey;
  return null;
}

async function proceed(direction: "next" | "back") {
  if (direction === "next" && !uploadedKey) {
    error = "Unggah foto sampul terlebih dahulu.";
    return;
  }
  const target =
    direction === "next" ? nextStep(data.draft.track, STEP) : previousStep(data.draft.track, STEP);
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Foto Sampul</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if uploadedKey}
    <p class="mb-3 font-sans text-sm font-medium text-success">Sampul sudah diunggah.</p>
  {/if}

  <div class="mb-6">
    <CoverUpload presign={presignCover} confirm={confirmCover} />
  </div>

  <div class="flex justify-between">
    <button
      type="button"
      onclick={() => proceed("back")}
      class="font-sans text-sm text-neutral-600"
    >
      Kembali
    </button>
    <button
      type="button"
      onclick={() => proceed("next")}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark"
    >
      Lanjutkan
    </button>
  </div>
</div>
