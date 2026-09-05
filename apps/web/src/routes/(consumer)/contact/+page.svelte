<script lang="ts">
import { api } from "$lib/api-client";
import { Alert, Button, FormField, TextInput } from "@fundforindonesia/ui";

// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let name = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let email = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let message = $state("");
let submitting = $state(false);
let error = $state<string | null>(null);
let submitted = $state(false);

async function submit() {
  error = null;
  submitting = true;
  const { error: apiError } = await api["support-tickets"].post({ name, email, message });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim pesan. Periksa kembali isian Anda.";
    return;
  }
  submitted = true;
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Hubungi Kami</h1>

  {#if error}
    <div class="mb-4">
      <Alert variant="error">{error}</Alert>
    </div>
  {/if}

  {#key submitted}
    {#if submitted}
      <Alert variant="success">Pesan Anda telah terkirim. Tim kami akan segera menghubungi Anda.</Alert>
    {:else}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormField label="Nama" id="name">
          <TextInput id="name" bind:value={name} />
        </FormField>
        <FormField label="Email" id="email">
          <TextInput id="email" type="email" bind:value={email} />
        </FormField>
        <FormField label="Pesan" id="message">
          <textarea
            id="message"
            bind:value={message}
            rows="5"
            class="w-full rounded-md border border-neutral-300 px-3 py-2 font-sans text-sm"
          ></textarea>
        </FormField>
        <Button type="submit" disabled={submitting}>Kirim</Button>
      </form>
    {/if}
  {/key}
</div>
