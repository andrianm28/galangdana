<script lang="ts">
import { goto } from "$app/navigation";
import { api } from "$lib/api-client";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data, params }: PageProps = $props();

const TYPE_LABELS: Record<string, string> = {
  partial: "Pencairan Sebagian",
  final: "Pencairan Akhir",
};

let error = $state<string | null>(null);
let submitting = $state(false);

async function submit() {
  error = null;
  submitting = true;
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { error: apiError } = await (api.disbursements as any)({
    id: params.disbursementId,
  }).submit.post();
  submitting = false;
  if (apiError) {
    error = "Gagal mengajukan pencairan. Pastikan Anda sudah memverifikasi OTP.";
    return;
  }
  await goto(`/dashboard/campaigns/${params.id}/pencairan/${params.disbursementId}/in-process`);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Ringkasan Pencairan</h1>

  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  <dl class="mb-6 space-y-2 font-sans text-sm">
    <div>
      <dt class="text-neutral-500">Jenis</dt>
      <dd>
        {data.disbursement.type
          ? (TYPE_LABELS[data.disbursement.type] ?? data.disbursement.type)
          : "-"}
      </dd>
    </div>
    <div>
      <dt class="text-neutral-500">Nominal</dt>
      <dd>Rp{data.disbursement.amount?.amount ?? "-"}</dd>
    </div>
    <div>
      <dt class="text-neutral-500">Keterangan</dt>
      <dd>{data.disbursement.narrative ?? "-"}</dd>
    </div>
  </dl>

  <Button onclick={submit} disabled={submitting}>Ajukan Pencairan</Button>
</div>
