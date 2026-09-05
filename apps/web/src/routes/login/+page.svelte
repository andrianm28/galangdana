<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { api } from "$lib/api-client";
import { Alert, Button, FormField, TextInput } from "@fundforindonesia/ui";

type Stage = "phone" | "code";

let stage: Stage = $state("phone");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let phone = $state("");
// biome-ignore lint/style/useConst: Svelte binding requires mutable let
let code = $state("");
let error = $state<string | null>(null);
let submitting = $state(false);

// Only honor redirectTo when it's a same-origin relative path. goto() throws
// on a cross-origin target (this isn't an open-redirect vector), but an
// unguarded crafted link would still produce an unhandled runtime error
// right after a successful login instead of a graceful fallback.
const redirectTo = $derived.by(() => {
  const raw = page.url.searchParams.get("redirectTo");
  // A protocol-relative value (e.g. "//evil.com") passes startsWith("/") but
  // is still cross-origin from goto()'s perspective -- exclude it too.
  return raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/";
});

async function requestOtp() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.auth.otp.request.post({ phone });
  submitting = false;
  if (apiError) {
    error = "Gagal mengirim kode OTP. Periksa nomor telepon Anda.";
    return;
  }
  stage = "code";
}

async function verifyOtp() {
  error = null;
  submitting = true;
  const { error: apiError } = await api.auth.otp.verify.post({ phone, code });
  submitting = false;
  if (apiError) {
    error = "Kode OTP salah atau kedaluwarsa.";
    return;
  }
  await goto(redirectTo);
}
</script>

<div class="mx-auto max-w-sm py-12">
  <h1 class="mb-6 font-sans text-xl font-bold text-neutral-900">Masuk ke FundForIndonesia</h1>

  {#if error}
    <div class="mb-4">
      <Alert variant="error">{error}</Alert>
    </div>
  {/if}

  {#if stage === "phone"}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        requestOtp();
      }}
    >
      <FormField label="Nomor telepon" id="phone" hint="Contoh: +6281234567890">
        <TextInput id="phone" type="tel" bind:value={phone} />
      </FormField>
      <Button type="submit" disabled={submitting}>Kirim kode OTP</Button>
    </form>
  {:else}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        verifyOtp();
      }}
    >
      <FormField label="Kode OTP" id="code" hint="Kode 6 digit yang baru saja dikirim">
        <TextInput id="code" type="text" bind:value={code} />
      </FormField>
      <Button type="submit" disabled={submitting}>Verifikasi</Button>
    </form>
  {/if}
</div>
