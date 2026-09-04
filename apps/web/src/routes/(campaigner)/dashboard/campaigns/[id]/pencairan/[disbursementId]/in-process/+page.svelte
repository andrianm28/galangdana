<script lang="ts">
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

const STATUS_LABELS: Record<string, string> = {
  requested: "Menunggu peninjauan admin",
  approved: "Disetujui, menunggu pencairan",
  rejected: "Ditolak",
  paid: "Dana telah dicairkan",
  failed: "Pencairan gagal",
};
</script>

<div class="mx-auto max-w-sm py-12 text-center">
  <h1 class="mb-4 font-sans text-xl font-bold text-neutral-900">Status Pencairan</h1>
  <p class="mb-2 font-sans text-lg">
    {STATUS_LABELS[data.disbursement.status] ?? data.disbursement.status}
  </p>
  {#if data.disbursement.status === "rejected" && data.disbursement.rejectedReason}
    <p class="font-sans text-sm text-red-600">{data.disbursement.rejectedReason}</p>
  {/if}
  {#if data.disbursement.status === "paid"}
    <p class="font-sans text-sm text-neutral-600">Referensi: {data.disbursement.payoutRef}</p>
  {/if}
  <p class="mt-6 font-sans text-xs text-neutral-500">
    Muat ulang halaman untuk memperbarui status.
  </p>
</div>
