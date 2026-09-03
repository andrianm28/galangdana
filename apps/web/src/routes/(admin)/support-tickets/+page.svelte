<script lang="ts">
import { api } from "$lib/api-client";
import { Button } from "@galangdana/ui";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();

let tickets = $state(data.tickets);
let error = $state<string | null>(null);

async function resolveTicket(id: string) {
  error = null;
  const { error: apiError } = await api.admin["support-tickets"]({ id }).resolve.post();
  if (apiError) {
    error = "Gagal menandai tiket sebagai selesai.";
    return;
  }
  tickets = tickets.filter((t) => t.id !== id);
}
</script>

<div class="max-w-2xl">
  {#if error}
    <p class="mb-4 font-sans text-sm text-red-600">{error}</p>
  {/if}

  {#if tickets.length === 0}
    <p class="font-sans text-neutral-600">Tidak ada tiket yang menunggu.</p>
  {:else}
    <ul class="space-y-4">
      {#each tickets as ticket (ticket.id)}
        <li class="border-b border-neutral-200 pb-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-sans font-medium text-neutral-900">{ticket.name}</p>
              <p class="font-sans text-sm text-neutral-500">{ticket.email}</p>
              <p class="mt-1 font-sans text-sm text-neutral-700">{ticket.message}</p>
            </div>
            <Button variant="secondary" onclick={() => resolveTicket(ticket.id)}>
              Tandai Selesai
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
