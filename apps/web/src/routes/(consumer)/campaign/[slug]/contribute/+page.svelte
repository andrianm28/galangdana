<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import PageTitle from "$lib/PageTitle.svelte";
import { api } from "$lib/api-client";
import { formatMoney } from "@fundforindonesia/money";
import { Button, FormField, TextInput } from "@fundforindonesia/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const amountStr = $derived(page.url.searchParams.get("amount") ?? "");
const amountLabel = $derived(
  /^\d+$/.test(amountStr) ? formatMoney({ amount: BigInt(amountStr), currency: "IDR" }) : "",
);
const paymentMethod = $derived(
  (page.url.searchParams.get("paymentMethod") ?? "bank_transfer_va") as
    | "bank_transfer_va"
    | "qris_redirect",
);

// Contact is optional. Asking for it before taking money costs conversion, and
// a donor who skips it still completes the donation and still sees the receipt
// on screen -- they just cannot be sent one afterwards, which the copy says
// plainly rather than implying the field is required.
// biome-ignore lint/style/useConst: reassigned by the channel toggle
let contactChannel = $state<"whatsapp" | "email">("whatsapp");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let contactValue = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let displayName = $state("");
let submitting = $state(false);
let error = $state<string | null>(null);

const contactLooksValid = $derived.by(() => {
  const v = contactValue.trim();
  if (!v) return true; // empty is allowed
  return contactChannel === "email"
    ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
    : /^[\d+][\d\s-]{7,}$/.test(v);
});

async function confirm() {
  if (!contactLooksValid) {
    error =
      contactChannel === "email"
        ? "Periksa lagi alamat emailnya."
        : "Periksa lagi nomor WhatsApp-nya.";
    return;
  }
  error = null;
  submitting = true;
  const trimmed = contactValue.trim();
  const { data: responseData, error: apiError } = await api.donations.post(
    {
      campaignId: data.campaign.id,
      amountStr,
      paymentMethod,
      ...(trimmed ? { contactChannel, contactValue: trimmed } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
    },
    { headers: { "idempotency-key": crypto.randomUUID() } },
  );
  submitting = false;
  if (apiError || !responseData || "error" in responseData) {
    error = "Gagal memproses donasi. Silakan coba lagi.";
    return;
  }
  if (responseData.method === "qris_redirect" && responseData.redirectUrl) {
    window.location.href = responseData.redirectUrl;
    return;
  }
  await goto(`/donation/status/${responseData.donationId}`);
}
</script>

<div class="mx-auto flex max-w-md flex-col gap-5 py-8">
  <div>
    <h1 class="font-sans text-lg font-bold text-neutral-900">Konfirmasi donasi</h1>
    <p class="mt-1 font-sans text-sm text-neutral-600">{data.campaign.title}</p>
  </div>

  <div class="flex items-baseline justify-between rounded-md border border-neutral-200 bg-white p-4">
    <span class="font-sans text-sm text-neutral-600">Nominal donasi</span>
    <span class="font-sans text-lg font-bold text-neutral-900 tabular-nums">{amountLabel}</span>
  </div>

  <div class="flex flex-col gap-3 rounded-md border border-neutral-200 bg-white p-4">
    <div>
      <p class="font-sans text-sm font-medium text-neutral-900">Kirim tanda terima ke mana?</p>
      <p class="mt-0.5 font-sans text-xs text-neutral-600">
        Boleh dikosongkan. Kalau kosong, donasi tetap berjalan — kami hanya tidak bisa
        mengirimkan tanda terimanya.
      </p>
    </div>

    <div class="flex gap-2">
      {#each [{ id: "whatsapp", label: "WhatsApp" }, { id: "email", label: "Email" }] as option (option.id)}
        <button
          type="button"
          onclick={() => (contactChannel = option.id as "whatsapp" | "email")}
          aria-pressed={contactChannel === option.id}
          class="flex-1 rounded-md border px-3 py-2 font-sans text-sm font-medium {contactChannel ===
          option.id
            ? 'border-primary bg-primary/5 text-primary-dark'
            : 'border-neutral-200 text-neutral-700 hover:border-neutral-300'}"
        >
          {option.label}
        </button>
      {/each}
    </div>

    <FormField
      label={contactChannel === "email" ? "Alamat email" : "Nomor WhatsApp"}
      id="contact"
    >
      <TextInput
        id="contact"
        bind:value={contactValue}
        inputmode={contactChannel === "email" ? "email" : "tel"}
        placeholder={contactChannel === "email" ? "nama@email.com" : "08xxxxxxxxxx"}
      />
    </FormField>

    <FormField label="Nama yang ditampilkan (opsional)" id="displayName">
      <TextInput id="displayName" bind:value={displayName} placeholder="Sesama" />
    </FormField>
    <p class="font-sans text-xs text-neutral-500">
      Dikosongkan berarti donasi Anda tampil sebagai “Sesama”.
    </p>
  </div>

  {#if error}
    <p class="font-sans text-sm font-medium text-red-700" role="alert">{error}</p>
  {/if}

  <Button onclick={confirm} disabled={submitting}>
    {submitting ? "Memproses…" : "Lanjut ke pembayaran"}
  </Button>
</div>

<PageTitle title={"Konfirmasi donasi"} />
