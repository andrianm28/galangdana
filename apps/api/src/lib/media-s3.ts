/**
 * Shared private-bucket S3 client for reading/writing campaign documents
 * and KYC files. Phase 2a (`campaign-drafts.ts`) and Phase 2c
 * (`campaigns.ts`) each instantiated their own near-identical
 * Bun.S3Client for this same bucket -- this is the third instance this
 * plan needs (admin document viewing, Task 6; campaign-scoped document
 * re-upload, Task 9), so it's extracted here instead of duplicated a
 * third time. The two existing instances in campaign-drafts.ts and
 * campaigns.ts are deliberately left as-is, not retrofitted to import
 * this -- re-touching already-shipped, already-reviewed files for a
 * style cleanup alone isn't worth the regression risk in this plan.
 */
export const privateDocumentsS3 = new Bun.S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
  accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "fundforindonesia",
  secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "fundforindonesia-dev-secret",
  bucket: process.env.MEDIA_S3_PRIVATE_BUCKET ?? "campaign-documents",
  region: "us-east-1",
});

export const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];

export function extractDocumentExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && ALLOWED_DOCUMENT_EXTENSIONS.includes(ext) ? ext : null;
}
