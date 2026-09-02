<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { nextStep, previousStep } from "../step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// biome-ignore lint/style/useConst: state variables must be let for reactivity
let name = $state(data.draft.patient?.name ?? "");
// biome-ignore lint/style/useConst: state variables must be let for reactivity
let age = $state(data.draft.patient?.age != null ? String(data.draft.patient.age) : "");
// biome-ignore lint/style/useConst: state variables must be let for reactivity
let illness = $state(data.draft.patient?.illness ?? "");
// biome-ignore lint/style/useConst: state variables must be let for reactivity
let hospitalName = $state(data.draft.patient?.hospitalName ?? "");
// biome-ignore lint/style/useConst: state variables must be let for reactivity
let relationshipToCampaigner = $state(data.draft.patient?.relationshipToCampaigner ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  const incomplete = !name.trim() || !illness.trim();
  if (direction === "next" && incomplete) {
    error = "Nama dan kondisi pasien wajib diisi.";
    return;
  }
  if (direction === "back" && incomplete) {
    const target = previousStep(data.draft.track, "pasien");
    if (target) await goto(`/create/${data.draft.id}/step/${target}`);
    return;
  }
  submitting = true;
  const { error: apiError } = await api["campaign-drafts"]({ id: data.draft.id }).patient.put({
    name,
    age: age ? Number(age) : undefined,
    illness,
    hospitalName: hospitalName || undefined,
    relationshipToCampaigner: relationshipToCampaigner || undefined,
  });
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan data pasien. Silakan coba lagi.";
    return;
  }
  const target =
    direction === "next"
      ? nextStep(data.draft.track, "pasien")
      : previousStep(data.draft.track, "pasien");
  if (target) await goto(`/create/${data.draft.id}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Data Pasien</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="patient-name" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nama pasien</label>
    <input id="patient-name" type="text" bind:value={name} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-age" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Usia</label>
    <input id="patient-age" type="number" min="0" bind:value={age} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-illness" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kondisi/penyakit</label>
    <input id="patient-illness" type="text" bind:value={illness} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-hospital" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Rumah sakit (opsional)</label>
    <input id="patient-hospital" type="text" bind:value={hospitalName} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="patient-relationship" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Hubungan dengan Anda (opsional)</label>
    <input id="patient-relationship" type="text" bind:value={relationshipToCampaigner} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
