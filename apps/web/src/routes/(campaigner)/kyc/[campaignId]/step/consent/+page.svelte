<script lang="ts">
import { goto } from "$app/navigation";
import { nextKycStep, previousKycStep } from "../kyc-step-order";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte $state runes require let for bind:
let agreed = $state(false);

async function proceed(direction: "next" | "back") {
  const target = direction === "next" ? nextKycStep("consent") : previousKycStep("consent");
  if (target) await goto(`/kyc/${data.kyc.campaignId}/step/${target}`);
}
</script>

<div>
  <h2 class="mb-4 font-sans text-lg font-semibold text-neutral-900">Persetujuan Verifikasi</h2>
  <p class="mb-4 font-sans text-sm text-neutral-600">
    Dengan melanjutkan, Anda menyetujui bahwa data dan dokumen identitas yang Anda unggah akan
    digunakan untuk memverifikasi identitas Anda sebagai penggalang dana pada platform ini.
  </p>

  <label class="mb-6 flex items-center gap-2 font-sans text-sm">
    <input type="checkbox" bind:checked={agreed} />
    Saya menyetujui dan data yang saya berikan adalah benar
  </label>

  <div class="flex justify-between">
    <button type="button" onclick={() => proceed("back")} class="font-sans text-sm text-neutral-600">Kembali</button>
    <button
      type="button"
      onclick={() => proceed("next")}
      disabled={!agreed}
      class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
    >
      Lanjutkan
    </button>
  </div>
</div>
