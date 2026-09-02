<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let name = $state("");
let relationship = $state("");
let needDescription = $state("");
let submitting = $state(false);
let error = $state<string | null>(null);

$effect(() => {
  name = data.draft.beneficiary?.name ?? "";
  relationship = data.draft.beneficiary?.relationship ?? "";
  needDescription = data.draft.beneficiary?.needDescription ?? "";
});

async function save(direction: "next" | "back") {
  error = null;
  if (direction === "next" && (!name.trim() || !needDescription.trim())) {
    error = "Nama dan kebutuhan penerima manfaat wajib diisi.";
    return;
  }
  submitting = true;
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).beneficiary.put({
    name,
    relationship: relationship || undefined,
    needDescription,
  });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan data penerima manfaat. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "penerima")
      : previousStep(data.draft.track, "penerima");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Data Penerima Manfaat</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="beneficiary-name" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nama penerima manfaat</label>
    <input id="beneficiary-name" type="text" bind:value={name} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="beneficiary-relationship" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Hubungan dengan Anda (opsional)</label>
    <input id="beneficiary-relationship" type="text" bind:value={relationship} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="beneficiary-need" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kebutuhan yang akan dipenuhi</label>
    <textarea id="beneficiary-need" bind:value={needDescription} rows="3" class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"></textarea>
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
