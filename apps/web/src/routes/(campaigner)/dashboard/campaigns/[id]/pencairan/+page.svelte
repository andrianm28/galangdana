<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { onMount } from "svelte";
import type { PageProps } from "./$types";

const { params }: PageProps = $props();

let error = $state<string | null>(null);

onMount(async () => {
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data, error: apiError } = await (api.campaigns as any)({
    id: params.id,
  }).disbursements.post();
  if (apiError || !data) {
    error = "Gagal memulai pengajuan pencairan. Pastikan campaign Anda sedang aktif.";
    return;
  }
  await goto(`/dashboard/campaigns/${params.id}/pencairan/${data.id}/rekening`);
});
</script>

{#if error}
  <p class="mx-auto max-w-sm py-12 text-center font-sans text-sm text-red-600">{error}</p>
{:else}
  <p class="mx-auto max-w-sm py-12 text-center font-sans text-sm text-neutral-500">Memuat...</p>
{/if}
