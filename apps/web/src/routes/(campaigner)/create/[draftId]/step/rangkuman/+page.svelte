<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { formatMoney, money } from "@galangdana/money";
import { getDocumentTypes } from "../dokumen/document-types";
import { previousStep } from "../step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let submitting = $state(false);
let error = $state<string | null>(null);

// Every document in this phase belongs to the draft's own track, so looking
// up labels via the draft's track is safe; fall back to the raw type string
// if a value isn't found (mirrors dokumen/+page.svelte's own typeLabel()).
const documentTypes = $derived(getDocumentTypes(data.draft.track));
function documentTypeLabel(value: string): string {
  return documentTypes.find((t) => t.value === value)?.label ?? value;
}

const title = $derived(
  typeof data.draft.answers.title === "string" ? data.draft.answers.title : "",
);
const purpose = $derived(
  typeof data.draft.answers.purpose === "string" ? data.draft.answers.purpose : "",
);
const callToAction = $derived(
  typeof data.draft.answers.callToAction === "string" ? data.draft.answers.callToAction : "",
);
const goalAmountStr = $derived(
  typeof data.draft.answers.goalAmountStr === "string" ? data.draft.answers.goalAmountStr : null,
);
const formattedGoal = $derived(
  goalAmountStr ? formatMoney(money(BigInt(goalAmountStr), "IDR")) : null,
);

async function submitForVerification() {
  error = null;
  submitting = true;
  const { data: created, error: apiError } = await api.campaigns.post({ draftId: data.draft.id });
  submitting = false;
  if (apiError || !created) {
    error = "Gagal mengajukan campaign untuk verifikasi. Silakan coba lagi.";
    return;
  }
  await goto(`/kyc/${created.id}/step/identity`);
}

async function back() {
  const target = previousStep(data.draft.track, "rangkuman");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Ringkasan Campaign</h2>

  <dl class="mb-6 space-y-4 font-sans text-sm">
    {#if title}
      <div>
        <dt class="font-medium text-neutral-900">Judul</dt>
        <dd class="text-neutral-600">{title}</dd>
      </div>
    {/if}
    {#if purpose}
      <div>
        <dt class="font-medium text-neutral-900">Tujuan</dt>
        <dd class="text-neutral-600">{purpose}</dd>
      </div>
    {/if}
    {#if formattedGoal}
      <div>
        <dt class="font-medium text-neutral-900">Target Donasi</dt>
        <dd class="text-neutral-600">{formattedGoal}</dd>
      </div>
    {/if}
    {#if callToAction}
      <div>
        <dt class="font-medium text-neutral-900">Ajakan</dt>
        <dd class="text-neutral-600">{callToAction}</dd>
      </div>
    {/if}

    <div>
      <dt class="font-medium text-neutral-900">Cerita</dt>
      {#if data.draft.manualStory}
        <dd class="whitespace-pre-line text-neutral-600">{data.draft.manualStory}</dd>
      {:else if data.draft.storyAnswers.length > 0}
        <dd class="space-y-1 text-neutral-600">
          {#each data.draft.storyAnswers.sort((a, b) => a.questionNumber - b.questionNumber) as answer (answer.questionNumber)}
            <p>{answer.answerText}</p>
          {/each}
        </dd>
      {:else}
        <dd class="text-neutral-400">Belum diisi</dd>
      {/if}
    </div>

    {#if data.draft.patient}
      <div>
        <dt class="font-medium text-neutral-900">Pasien</dt>
        <dd class="text-neutral-600"><span>{data.draft.patient.name}</span> — {data.draft.patient.illness}</dd>
      </div>
    {/if}
    {#if data.draft.beneficiary}
      <div>
        <dt class="font-medium text-neutral-900">Penerima Manfaat</dt>
        <dd class="text-neutral-600">{data.draft.beneficiary.name} — {data.draft.beneficiary.needDescription}</dd>
      </div>
    {/if}

    <div>
      <dt class="font-medium text-neutral-900">Dokumen ({data.draft.documents.length})</dt>
      {#if data.draft.documents.length > 0}
        <dd class="text-neutral-600">
          {#each data.draft.documents as doc (doc.id)}
            <p>{documentTypeLabel(doc.type)}</p>
          {/each}
        </dd>
      {:else}
        <dd class="text-neutral-400">Belum ada dokumen diunggah</dd>
      {/if}
    </div>
  </dl>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={back} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button
      type="button"
      onclick={submitForVerification}
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Ajukan Verifikasi
    </button>
  </div>
</div>
