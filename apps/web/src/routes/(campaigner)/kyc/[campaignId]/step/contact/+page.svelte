<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import type { Treaty } from "@elysiajs/eden";
import { nextKycStep, previousKycStep } from "../kyc-step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let address = $state(data.kyc.address ?? "");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let city = $state(data.kyc.city ?? "");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let postalCode = $state(data.kyc.postalCode ?? "");
let submitting = $state(false);
let error = $state<string | null>(null);

async function save(direction: "next" | "back") {
  error = null;
  const incomplete = !address.trim() || !city.trim() || !postalCode.trim();
  if (direction === "next" && incomplete) {
    error = "Lengkapi alamat, kota, dan kode pos.";
    return;
  }
  if (direction === "back" && incomplete) {
    const target = previousKycStep("contact");
    if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
    return;
  }
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: apiError } = (await (api.campaigns as any)({
    id: data.kyc.campaignId,
  }).kyc.contact.put({ address, city, postalCode })) as Treaty.TreatyResponse<{
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
  const target = direction === "next" ? nextKycStep("contact") : previousKycStep("contact");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Alamat</h2>

  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  <div class="mb-4">
    <label for="address" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Alamat</label>
    <textarea id="address" bind:value={address} rows="2" class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"></textarea>
  </div>
  <div class="mb-4">
    <label for="city" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kota</label>
    <input id="city" type="text" bind:value={city} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>
  <div class="mb-4">
    <label for="postal-code" class="mb-1 block font-sans text-sm font-medium text-neutral-900">Kode pos</label>
    <input id="postal-code" type="text" bind:value={postalCode} class="w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm" />
  </div>

  <div class="mt-6 flex justify-between">
    <button type="button" onclick={() => save("back")} disabled={submitting} class="font-sans text-sm text-neutral-600 disabled:opacity-50">Kembali</button>
    <button type="button" onclick={() => save("next")} disabled={submitting} class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Lanjutkan</button>
  </div>
</div>
