<script lang="ts">
import { goto } from "$app/navigation";
import { formatMoney, money } from "@galangdana/money";
import { previousStep } from "../step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

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
            <p>{doc.type}</p>
          {/each}
        </dd>
      {:else}
        <dd class="text-neutral-400">Belum ada dokumen diunggah</dd>
      {/if}
    </div>
  </dl>

  <p class="mb-6 rounded-sm bg-neutral-100 p-3 font-sans text-sm text-neutral-600">
    Verifikasi identitas dan pengajuan akhir campaign akan tersedia setelah langkah verifikasi
    ditambahkan pada tahap berikutnya.
  </p>

  <button type="button" onclick={back} class="font-sans text-sm text-neutral-600">Kembali</button>
</div>
