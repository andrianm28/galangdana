<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";

const STEP = "judul";
const ANSWER_KEY = "title";

const { data }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte $state runes require let for bind:
let value = $state(String(data.draft.answers[ANSWER_KEY] ?? ""));
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next" && !value.trim()) {
    error = "Kolom ini wajib diisi.";
    return;
  }
  submitting = true;
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).answers.patch({
    step: STEP,
    answers: { [ANSWER_KEY]: value },
  });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next" ? nextStep(data.draft.track, STEP) : previousStep(data.draft.track, STEP);
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Judul Campaign</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <label for={ANSWER_KEY} class="mb-2 block font-sans text-sm font-medium text-neutral-900">
    Judul yang menarik dan jelas
  </label>
  <input id={ANSWER_KEY} bind:value type="text" class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base" />

  <div class="mt-6 flex justify-between">
    <button
      type="button"
      onclick={() => save("back")}
      disabled={submitting}
      class="font-sans text-sm text-neutral-600 disabled:opacity-50"
    >
      Kembali
    </button>
    <button
      type="button"
      onclick={() => save("next")}
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Lanjutkan
    </button>
  </div>
</div>
