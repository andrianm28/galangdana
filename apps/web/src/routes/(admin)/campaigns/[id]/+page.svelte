<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { formatMoney, moneyFromJSON } from "@galangdana/money";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const REVISION_FIELDS = [
  { key: "cerita", label: "Cerita" },
  { key: "target_donasi", label: "Target Donasi" },
  { key: "kartu_mahasiswa", label: "Kartu Mahasiswa" },
  { key: "kartu_pelajar", label: "Kartu Pelajar" },
  { key: "tagihan_rumah_sakit", label: "Tagihan Rumah Sakit" },
  { key: "tagihan_institusi_pendidikan", label: "Tagihan Institusi Pendidikan" },
  { key: "media_sosial", label: "Media Sosial" },
  { key: "sumber_gambar", label: "Sumber Gambar" },
] as const;

type RevisionFieldKey = (typeof REVISION_FIELDS)[number]["key"];

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  REVISION_FIELDS.map((f) => [f.key, f.label]),
);

const goal = $derived(data.campaign.goalAmount ? moneyFromJSON(data.campaign.goalAmount) : null);

let selectedFields = $state<Set<RevisionFieldKey>>(new Set());
let notes = $state<Record<string, string>>({});
let submitting = $state(false);
let error = $state<string | null>(null);

function toggleField(key: RevisionFieldKey) {
  const next = new Set(selectedFields);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedFields = next;
}

function updateNote(key: string, value: string) {
  notes = { ...notes, [key]: value };
}

async function approve() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.admin.campaigns({ id: data.campaign.id }).approve.post();
  submitting = false;
  if (apiError) {
    error = "Gagal menyetujui campaign.";
    return;
  }
  await goto("/dashboard");
}

async function requestRevision() {
  error = null;
  const items = Array.from(selectedFields)
    .map((field) => ({ field, note: notes[field]?.trim() ?? "" }))
    .filter((item) => item.note.length > 0);
  if (items.length === 0) {
    error = "Pilih minimal satu bagian dan tulis catatan revisi.";
    return;
  }
  submitting = true;
  // Bracket notation, not dot notation: "request-revision" is a
  // hyphenated route segment, and Eden Treaty does NOT auto-camelCase a
  // kebab-case path segment (see this plan's Global Constraint on the
  // Eden Treaty kebab-case gotcha).
  const { error: apiError } = await api.admin
    .campaigns({ id: data.campaign.id })
    ["request-revision"].post({ items });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim permintaan revisi.";
    return;
  }
  await goto("/dashboard");
}
</script>

<div class="max-w-3xl">
  <h2 class="mb-1 font-sans text-xl font-semibold text-neutral-900">{data.campaign.title}</h2>
  <p class="mb-6 font-sans text-sm text-neutral-500">
    {data.campaign.campaignerName} &middot; {data.campaign.category.title}
  </p>

  {#if error}
    <p class="mb-4 font-sans text-sm text-error">{error}</p>
  {/if}

  <section class="mb-6">
    <h3 class="mb-2 font-sans text-sm font-semibold text-neutral-900">Cerita</h3>
    <p class="whitespace-pre-line font-sans text-sm text-neutral-700">{data.campaign.story}</p>
  </section>

  <section class="mb-6">
    <h3 class="mb-2 font-sans text-sm font-semibold text-neutral-900">Target Donasi</h3>
    <p class="font-sans text-sm text-neutral-700">{goal ? formatMoney(goal) : "-"}</p>
  </section>

  <section class="mb-6">
    <h3 class="mb-2 font-sans text-sm font-semibold text-neutral-900">Dokumen Pendukung</h3>
    {#if data.campaign.documents.length === 0}
      <p class="font-sans text-sm text-neutral-500">Belum ada dokumen diunggah.</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each data.campaign.documents as document (document.id)}
          <li>
            <a
              href={document.viewUrl}
              target="_blank"
              rel="noreferrer"
              class="font-sans text-sm text-primary hover:underline"
            >
              {FIELD_LABELS[document.type] ?? document.type}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="mb-6">
    <h3 class="mb-2 font-sans text-sm font-semibold text-neutral-900">Riwayat Revisi</h3>
    {#if data.campaign.revisions.length === 0}
      <p class="font-sans text-sm text-neutral-500">Belum ada permintaan revisi.</p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each data.campaign.revisions as revision (revision.id)}
          <li class="rounded-sm border border-neutral-200 p-2">
            <p class="font-sans text-sm font-semibold text-neutral-900">
              {FIELD_LABELS[revision.field] ?? revision.field}
              <span class="font-normal text-neutral-500">({revision.status})</span>
            </p>
            <p class="font-sans text-sm text-neutral-600">{revision.note}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="mb-6">
    <h3 class="mb-2 font-sans text-sm font-semibold text-neutral-900">Data KYC</h3>
    <dl class="grid grid-cols-2 gap-2 font-sans text-sm">
      <dt class="text-neutral-500">Nama Lengkap</dt>
      <dd class="text-neutral-900">{data.campaign.verification.fullName}</dd>
      <dt class="text-neutral-500">NIK</dt>
      <dd class="text-neutral-900">{data.campaign.verification.nationalId}</dd>
      <dt class="text-neutral-500">Tanggal Lahir</dt>
      <dd class="text-neutral-900">{data.campaign.verification.dateOfBirth}</dd>
      <dt class="text-neutral-500">Alamat</dt>
      <dd class="text-neutral-900">
        {data.campaign.verification.address}, {data.campaign.verification.city}
        {data.campaign.verification.postalCode}
      </dd>
    </dl>
    <div class="mt-4 flex gap-4">
      {#if data.campaign.verification.ktpViewUrl}
        <a
          href={data.campaign.verification.ktpViewUrl}
          target="_blank"
          rel="noreferrer"
          class="font-sans text-sm text-primary hover:underline"
        >
          Lihat KTP
        </a>
      {/if}
      {#if data.campaign.verification.selfieViewUrl}
        <a
          href={data.campaign.verification.selfieViewUrl}
          target="_blank"
          rel="noreferrer"
          class="font-sans text-sm text-primary hover:underline"
        >
          Lihat Selfie
        </a>
      {/if}
    </div>
  </section>

  <section class="mb-6 rounded-sm border border-neutral-200 p-4">
    <h3 class="mb-3 font-sans text-sm font-semibold text-neutral-900">Minta Revisi</h3>
    {#each REVISION_FIELDS as revisionField (revisionField.key)}
      <div class="mb-3">
        <label class="flex items-center gap-2 font-sans text-sm">
          <input
            type="checkbox"
            id="revision-{revisionField.key}"
            checked={selectedFields.has(revisionField.key)}
            onchange={() => toggleField(revisionField.key)}
          />
          {revisionField.label}
        </label>
        {#if selectedFields.has(revisionField.key)}
          <label for="note-{revisionField.key}" class="sr-only">Catatan untuk {revisionField.label}</label>
          <textarea
            id="note-{revisionField.key}"
            rows="2"
            class="mt-1 w-full rounded-sm border border-neutral-200 px-3 py-2 font-sans text-sm"
            oninput={(e) =>
              updateNote(revisionField.key, (e.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        {/if}
      </div>
    {/each}
    <button
      type="button"
      onclick={requestRevision}
      disabled={submitting}
      class="rounded-sm border border-primary px-4 py-2 font-sans text-sm font-semibold text-primary disabled:opacity-50"
    >
      Minta Revisi
    </button>
  </section>

  <button
    type="button"
    onclick={approve}
    disabled={submitting}
    class="rounded-sm bg-primary px-4 py-2 font-sans font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
  >
    Setujui
  </button>
</div>
