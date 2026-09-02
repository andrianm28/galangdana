<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";
import { getGuidedQuestions } from "./guided-questions";

const { data }: PageProps = $props();

const questions = getGuidedQuestions(data.draft.track);

// Guided mode is the default UNLESS the draft already has a manual story
// and no guided answers -- matches the invariant Task 8's API enforces
// (a draft never has both simultaneously).
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let mode: "guided" | "manual" = $state(
  data.draft.manualStory && data.draft.storyAnswers.length === 0 ? "manual" : "guided",
);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let guidedAnswers: string[] = $state(
  questions.map(
    (_, i) => data.draft.storyAnswers.find((a) => a.questionNumber === i + 1)?.answerText ?? "",
  ),
);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let manualText = $state(data.draft.manualStory ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next") {
    const incomplete =
      mode === "guided" ? guidedAnswers.some((a) => !a.trim()) : !manualText.trim();
    if (incomplete) {
      error = "Lengkapi cerita campaign sebelum melanjutkan.";
      return;
    }
  }
  submitting = true;
  const body =
    mode === "guided"
      ? {
          mode: "guided" as const,
          answers: guidedAnswers.map((answerText, i) => ({ questionNumber: i + 1, answerText })),
        }
      : { mode: "manual" as const, text: manualText };
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).story.put(body);
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan cerita. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "cerita")
      : previousStep(data.draft.track, "cerita");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Cerita Campaign</h2>

  <div class="mb-4 flex gap-4 font-sans text-sm">
    <button
      type="button"
      onclick={() => (mode = "guided")}
      class={mode === "guided" ? "font-semibold text-primary" : "text-neutral-600"}
    >
      Ikuti panduan
    </button>
    <button
      type="button"
      onclick={() => (mode = "manual")}
      class={mode === "manual" ? "font-semibold text-primary" : "text-neutral-600"}
    >
      Tulis manual
    </button>
  </div>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if mode === "guided"}
    <!--
      The wrapping div here is load-bearing, not decorative: this Svelte
      5.57.0 / vite-plugin-svelte toolchain has a confirmed teardown bug
      where an {#if} block whose ONLY child is a bare {#each} block fails
      to unmount that each-block's DOM when the condition flips (verified
      with an isolated minimal repro -- toggling `mode` left all 6
      guided textareas in the DOM alongside the new manual textarea,
      7 total instead of 1). Wrapping the {#each} in any element avoids
      the compiler's (buggy) single-child block optimization.
    -->
    <div>
      {#each questions as question, i (i)}
        <div class="mb-4">
          <label for="q-{i}" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
            {question}
          </label>
          <textarea
            id="q-{i}"
            bind:value={guidedAnswers[i]}
            rows="2"
            class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
          ></textarea>
        </div>
      {/each}
    </div>
  {:else}
    <textarea
      bind:value={manualText}
      rows="10"
      class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
      placeholder="Tuliskan cerita lengkap campaign Anda di sini..."
    ></textarea>
  {/if}

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
