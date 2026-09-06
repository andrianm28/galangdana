// Confirm-time content verification for private-bucket uploads.
//
// The presign step validates only the file *name* extension, so an attacker
// can PUT arbitrary bytes (HTML, executables, multi-gigabyte junk) under a
// `.png` name into the private bucket. This runs at confirm time, before
// any DB row references the object: a HEAD for existence + size, then a
// ranged GET of the first bytes compared against the extension's magic
// numbers (server-side sniffing -- the uploader-supplied Content-Type
// header is NOT trusted). Rejected objects are deleted so junk cannot
// accumulate; the caller maps the error to a 422.
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const MAGIC_BY_EXTENSION: Record<string, number[]> = {
  jpg: [0xff, 0xd8, 0xff],
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
};

export type DocumentContentError =
  | "document_not_found"
  | "document_too_large"
  | "document_content_mismatch";

export async function verifyUploadedDocumentContent(
  s3: Bun.S3Client,
  objectKey: string,
  ext: string,
  opts: { maxBytes?: number } = {},
): Promise<{ ok: true } | { ok: false; error: DocumentContentError }> {
  const maxBytes = opts.maxBytes ?? MAX_DOCUMENT_BYTES;

  const headUrl = s3.presign(objectKey, { method: "HEAD", expiresIn: 60 });
  const head = await fetch(headUrl, { method: "HEAD" });
  if (!head.ok) return { ok: false, error: "document_not_found" };

  const size = Number(head.headers.get("content-length") ?? "0");
  if (!Number.isFinite(size) || size > maxBytes) {
    await s3.delete(objectKey).catch(() => {});
    return { ok: false, error: "document_too_large" };
  }

  const magic = MAGIC_BY_EXTENSION[ext.toLowerCase()];
  if (!magic) {
    await s3.delete(objectKey).catch(() => {});
    return { ok: false, error: "document_content_mismatch" };
  }
  const getUrl = s3.presign(objectKey, { expiresIn: 60 });
  const ranged = await fetch(getUrl, { headers: { Range: `bytes=0-${magic.length - 1}` } });
  if (!ranged.ok) return { ok: false, error: "document_not_found" };
  const bytes = new Uint8Array(await ranged.arrayBuffer());
  const matches = magic.every((b, i) => bytes[i] === b);
  if (!matches) {
    await s3.delete(objectKey).catch(() => {});
    return { ok: false, error: "document_content_mismatch" };
  }

  return { ok: true };
}
