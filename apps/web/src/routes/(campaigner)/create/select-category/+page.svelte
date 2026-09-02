<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { getStepOrder } from "../[draftId]/step/step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let track: "medical" | "non_medical" = $state("medical");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let categoryId = $state<number | undefined>(data.categories[0]?.id);
let submitting = $state(false);
let error = $state<string | null>(null);

async function createDraft() {
  error = null;
  submitting = true;
  // Bracket notation required -- Eden Treaty does NOT camelCase a kebab-case
  // route prefix (this plan's Global Constraint). api.campaignDrafts(...) silently 404s.
  // @ts-expect-error Eden Treaty types don't recognize bracket notation correctly
  const { data: draft, error: apiError } = await api["campaign-drafts"].post({
    track,
    categoryId,
  });
  submitting = false;
  if (apiError || !draft) {
    error = "Gagal membuat draft campaign. Silakan coba lagi.";
    return;
  }
  const firstStep = getStepOrder(draft.track)[0];
  await goto(`/create/${draft.id}/step/${firstStep}`);
}
</script>

<div class="mx-auto max-w-md px-4 py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Pilih Jenis Campaign</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-error">{error}</p>
  {/if}

  <form
    onsubmit={(e) => {
      e.preventDefault();
      createDraft();
    }}
  >
    <fieldset class="mb-4">
      <legend class="mb-2 font-sans text-sm font-medium text-neutral-900">Jenis campaign</legend>
      <label class="mb-1 flex items-center gap-2 font-sans text-sm">
        <input type="radio" bind:group={track} value="medical" />
        Medis
      </label>
      <label class="flex items-center gap-2 font-sans text-sm">
        <input type="radio" bind:group={track} value="non_medical" />
        Non-medis
      </label>
    </fieldset>

    <div class="mb-6">
      <label for="category" class="mb-2 block font-sans text-sm font-medium text-neutral-900">
        Kategori
      </label>
      <select
        id="category"
        bind:value={categoryId}
        class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-base"
      >
        {#each data.categories as category (category.id)}
          <option value={category.id}>{category.title}</option>
        {/each}
      </select>
    </div>

    <button
      type="submit"
      disabled={submitting}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Buat Draft
    </button>
  </form>
</div>
