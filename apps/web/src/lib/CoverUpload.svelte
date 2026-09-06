<script lang="ts">
/**
 * Shared cover-photo uploader: file select with local preview, presigned
 * PUT, then confirm. The server calls differ per flow (draft wizard vs
 * campaign), so both arrive as props and this component owns only UI
 * state -- never API shapes.
 */
interface Props {
  presign: (fileName: string) => Promise<{ uploadUrl: string; objectKey: string } | null>;
  confirm: (objectKey: string) => Promise<string | null>;
  onUploaded?: (objectKey: string) => void;
}

const { presign, confirm, onUploaded }: Props = $props();

let selectedFile: File | null = $state(null);
let previewUrl: string | null = $state(null);
let uploading = $state(false);
let error: string | null = $state(null);
let done = $state(false);

function selectFile(file: File | null) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  selectedFile = file;
  previewUrl = file ? URL.createObjectURL(file) : null;
  done = false;
}

async function upload() {
  if (!selectedFile) {
    error = "Pilih file terlebih dahulu.";
    return;
  }
  error = null;
  uploading = true;

  const presigned = await presign(selectedFile.name);
  if (!presigned) {
    uploading = false;
    error = "Gagal menyiapkan unggahan. Periksa format file (jpg/jpeg/png).";
    return;
  }

  const putResp = await fetch(presigned.uploadUrl, { method: "PUT", body: selectedFile });
  if (!putResp.ok) {
    uploading = false;
    error = "Gagal mengunggah file.";
    return;
  }

  const confirmError = await confirm(presigned.objectKey);
  uploading = false;
  if (confirmError) {
    error = confirmError;
    return;
  }

  done = true;
  selectFile(null);
  onUploaded?.(presigned.objectKey);
}
</script>

<div>
  {#if error}
    <p class="mb-3 font-sans text-sm text-error">{error}</p>
  {/if}

  {#if previewUrl}
    <img src={previewUrl} alt="Pratinjau sampul" class="mb-3 aspect-[4/3] w-full rounded-sm object-cover" />
  {/if}

  <label for="cover-file" class="mb-1 block font-sans text-sm font-medium text-neutral-900">
    Foto sampul (jpg/jpeg/png)
  </label>
  <input
    id="cover-file"
    type="file"
    accept=".jpg,.jpeg,.png"
    onchange={(e) => selectFile((e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
  />

  <button
    type="button"
    onclick={upload}
    disabled={uploading}
    class="mt-3 rounded-sm border border-primary px-4 py-2 font-sans text-sm font-semibold text-primary disabled:opacity-50"
  >
    Unggah
  </button>

  {#if done}
    <span class="ml-2 font-sans text-xs font-medium text-success">Tersimpan</span>
  {/if}
</div>
