<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { Button, FormField, TextInput } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data, params }: PageProps = $props();

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let selectedId = $state<string | null>(data.bankAccounts[0]?.id ?? null);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let showNewForm = $state(data.bankAccounts.length === 0);
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let bankCode = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let bankName = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let accountNumber = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let accountHolderName = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

async function proceed() {
  error = null;

  if (!showNewForm && !selectedId) {
    error = "Pilih atau tambahkan rekening bank.";
    return;
  }
  if (
    showNewForm &&
    (!bankCode.trim() || !bankName.trim() || !accountNumber.trim() || !accountHolderName.trim())
  ) {
    error = "Pilih atau tambahkan rekening bank.";
    return;
  }

  submitting = true;
  let bankAccountId = selectedId;

  if (showNewForm) {
    // biome-ignore lint/suspicious/noExplicitAny: Eden bracket-notation cast
    const { data: created, error: createError } = await (api["bank-accounts"] as any).post({
      bankCode,
      bankName,
      accountNumber,
      accountHolderName,
    });
    if (createError || !created) {
      error = "Gagal menyimpan rekening.";
      submitting = false;
      return;
    }
    bankAccountId = created.id;
  }

  if (!bankAccountId) {
    error = "Pilih atau tambahkan rekening bank.";
    submitting = false;
    return;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: patchError } = await (api.disbursements as any)({
    id: params.disbursementId,
  })["bank-account"].patch({ bankAccountId });
  submitting = false;
  if (patchError) {
    error = "Gagal menyimpan rekening ke pengajuan pencairan.";
    return;
  }
  await goto(`/dashboard/campaigns/${params.id}/pencairan/${params.disbursementId}/upload`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Rekening Pencairan</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  {#if data.bankAccounts.length > 0}
    <fieldset class="mb-4 space-y-2">
      {#each data.bankAccounts as account (account.id)}
        <label class="flex items-center gap-2 font-sans text-sm">
          <input
            type="radio"
            name="bankAccount"
            value={account.id}
            checked={selectedId === account.id && !showNewForm}
            onchange={() => {
              selectedId = account.id;
              showNewForm = false;
            }}
          />
          {account.bankName} - {account.accountNumber} ({account.accountHolderName})
          {#if !account.verifiedAt}<span class="text-amber-600">belum diverifikasi</span>{/if}
        </label>
      {/each}
    </fieldset>
    <button
      type="button"
      class="mb-4 font-sans text-sm text-primary underline"
      onclick={() => (showNewForm = !showNewForm)}
    >
      {showNewForm ? "Batal tambah rekening baru" : "+ Tambah rekening baru"}
    </button>
  {/if}

  {#if showNewForm}
    <FormField label="Kode Bank" id="bankCode">
      <TextInput id="bankCode" bind:value={bankCode} placeholder="bca" />
    </FormField>
    <FormField label="Nama Bank" id="bankName">
      <TextInput id="bankName" bind:value={bankName} placeholder="Bank Central Asia" />
    </FormField>
    <FormField label="Nomor Rekening" id="accountNumber">
      <TextInput id="accountNumber" bind:value={accountNumber} />
    </FormField>
    <FormField label="Nama Pemilik Rekening" id="accountHolderName">
      <TextInput id="accountHolderName" bind:value={accountHolderName} />
    </FormField>
  {/if}

  <Button onclick={proceed} disabled={submitting}>Lanjutkan</Button>
</div>
