<script lang="ts">
import KycUploadPage from "../kyc-upload/kyc-upload-page.svelte";
import type { PageProps } from "./$types";

const { data }: PageProps = $props();
</script>

<KycUploadPage {data} documentType="selfie" stepName="upload-selfie" heading="Unggah Foto Selfie" />
