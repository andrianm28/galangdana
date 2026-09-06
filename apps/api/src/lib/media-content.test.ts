import { afterAll, describe, expect, test } from "bun:test";
import { verifyUploadedDocumentContent } from "./media-content";

function testClient() {
  return new Bun.S3Client({
    endpoint: process.env.MEDIA_S3_ENDPOINT ?? "http://localhost:9000",
    accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? "fundforindonesia",
    secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? "fundforindonesia-dev-secret",
    bucket: process.env.MEDIA_S3_PRIVATE_BUCKET ?? "campaign-documents",
    region: "us-east-1",
  });
}

const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478d763f800010005fe02fea4de2c0000000049454e44ae426082",
  "hex",
);
const JPEG_MIN = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);
const PDF_MIN = Buffer.from("%PDF-1.4\n%test-bytes-for-mime-sniff\n");
const HTML_MASQUERADE = Buffer.from("<html><body>not an image</body></html>");

const uploaded: string[] = [];

async function putBytes(name: string, bytes: Buffer, contentType: string): Promise<string> {
  const s3 = testClient();
  const key = `media-content-test/${Date.now()}-${Math.random().toString(36).slice(2)}/${name}`;
  await s3.write(key, bytes, { type: contentType });
  uploaded.push(key);
  return key;
}

afterAll(async () => {
  const s3 = testClient();
  for (const key of uploaded) {
    await s3.delete(key).catch(() => {});
  }
});

describe("verifyUploadedDocumentContent", () => {
  test("accepts a real PNG under the limit", async () => {
    const key = await putBytes("a.png", PNG_1X1, "image/png");
    expect(await verifyUploadedDocumentContent(testClient(), key, "png")).toEqual({ ok: true });
  });

  test("accepts JPEG and PDF by their magic bytes, not the declared header", async () => {
    const jpg = await putBytes("b.jpg", JPEG_MIN, "application/octet-stream");
    expect(await verifyUploadedDocumentContent(testClient(), jpg, "jpg")).toEqual({ ok: true });
    const pdf = await putBytes("c.pdf", PDF_MIN, "application/octet-stream");
    expect(await verifyUploadedDocumentContent(testClient(), pdf, "pdf")).toEqual({ ok: true });
  });

  test("rejects HTML bytes wearing a .png name, and deletes the object", async () => {
    const key = await putBytes("evil.png", HTML_MASQUERADE, "image/png");
    const result = await verifyUploadedDocumentContent(testClient(), key, "png");
    expect(result).toEqual({ ok: false, error: "document_content_mismatch" });
    // Junk must not linger in the private bucket.
    const s3 = testClient();
    const head = await fetch(s3.presign(key, { method: "HEAD", expiresIn: 60 } as never), {
      method: "HEAD",
    });
    expect(head.status).toBe(404);
  });

  test("rejects oversized uploads against a small test cap", async () => {
    const key = await putBytes("big.png", PNG_1X1, "image/png");
    const result = await verifyUploadedDocumentContent(testClient(), key, "png", { maxBytes: 10 });
    expect(result).toEqual({ ok: false, error: "document_too_large" });
  });

  test("reports a missing object instead of throwing", async () => {
    const result = await verifyUploadedDocumentContent(
      testClient(),
      "media-content-test/does-not-exist.png",
      "png",
    );
    expect(result).toEqual({ ok: false, error: "document_not_found" });
  });
});
