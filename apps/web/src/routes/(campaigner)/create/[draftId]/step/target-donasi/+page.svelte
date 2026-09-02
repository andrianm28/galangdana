<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";

const STEP = "target-donasi";
const ANSWER_KEY = "goalAmountStr";

const { data }: PageProps = $props();

// Not bound via bind:value -- Svelte's bind:value on a type="number" input
// coerces through to_number() (empty string -> null, else +value -> a real
// number) before calling set(), which breaks this whole project's
// "money is always a decimal string" convention and makes save("next")'s
// value.trim() throw the moment a user types a digit. Kept a plain string
// end-to-end via one-way value={value} + an oninput handler instead (see
// this task's Deviations for the full root-cause trace). Reassigned only in
// that oninput handler below, which lives inside a template expression --
// biome's linter doesn't see assignments there, only ones in the script
// block, so it can't tell `value` is ever reassigned at all.
// biome-ignore lint/style/useConst: reassigned in the oninput handler below
let value = $state(String(data.draft.answers[ANSWER_KEY] ?? ""));
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next" && !value.trim()) {
    error = "Kolom ini wajib diisi.";
    return;
  }
  if (direction === "back" && !value.trim()) {
    const target = previousStep(data.draft.track, STEP);
    if (target) await goto(`/create/${data.draft.id}/step/${target}`);
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
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Target Donasi</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <label for={ANSWER_KEY} class="mb-2 block font-sans text-sm font-medium text-neutral-900">
    Jumlah target (Rp)
  </label>
  <input
    id={ANSWER_KEY}
    type="number"
    min="10000"
    step="1000"
    value={value}
    oninput={(e) => (value = (e.currentTarget as HTMLInputElement).value)}
    class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base"
  />

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
