<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import { nextKycStep, previousKycStep } from "../kyc-step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let fullName = $state(data.kyc.fullName ?? "");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let nationalId = $state(data.kyc.nationalId ?? "");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let dateOfBirth = $state(data.kyc.dateOfBirth ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  const incomplete = !fullName.trim() || nationalId.trim().length !== 16 || !dateOfBirth.trim();
  if (direction === "next" && incomplete) {
    error = "Lengkapi nama, NIK (16 digit), dan tanggal lahir.";
    return;
  }
  if (direction === "back" && incomplete) {
    const target = previousKycStep("identity");
    if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
    return;
  }
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: apiError } = (await (api.campaigns as any)({
    id: data.kyc.campaignId,
  }).kyc.identity.put({ fullName, nationalId, dateOfBirth })) as Treaty.TreatyResponse<{
    // The cast above erases Eden's inference for this whole chain to `any` -- confining that
    // escape hatch to just the unresolvable overload, this re-establishes the real response
    // shape (matching this endpoint's actual `response: { 200, 401, 404 }` map in
    // apps/api/src/routes/campaigns.ts) so `apiError` is still checked against
    // the real KycStatusResponse error shapes.
    200: { success: boolean };
    401: { error: string };
    404: { error: string };
  }>;
  submitting = false;
  if (apiError) {
    error = "Gagal menyimpan. Silakan coba lagi.";
    return;
  }
  const target = direction === "next" ? nextKycStep("identity") : previousKycStep("identity");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Data Diri</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="full-name" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nama lengkap (sesuai KTP)</label>
    <input id="full-name" type="text" bind:value={fullName} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="national-id" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Nomor Induk Kependudukan (NIK)</label>
    <input id="national-id" type="text" maxlength="16" bind:value={nationalId} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="dob" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Tanggal lahir</label>
    <input id="dob" type="date" bind:value={dateOfBirth} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
