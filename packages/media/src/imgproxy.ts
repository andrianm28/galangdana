export interface ImgproxyResize {
  width: number;
  height: number;
}

export interface ImgproxyOptions {
  /** Hex-encoded signing key. In apps/api this comes from process.env.IMGPROXY_KEY. */
  key: string;
  /** Hex-encoded signing salt. In apps/api this comes from process.env.IMGPROXY_SALT. */
  salt: string;
  /** The imgproxy server's own base URL, e.g. http://localhost:8090 in dev. */
  baseUrl: string;
  /** Base URL the source object key is resolved against, e.g. the media bucket's public/internal endpoint. */
  sourceBaseUrl: string;
  resize: ImgproxyResize;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * imgproxy's URL-signing scheme, verified against a real running imgproxy
 * instance: HMAC-SHA256 over (salt bytes ++ UTF-8 path bytes), base64url
 * encoded (no padding -- Node/Bun's "base64url" Buffer encoding already
 * omits padding, matching what imgproxy expects). Key and salt are
 * hex-encoded strings, decoded to raw bytes before signing -- passing the
 * hex STRING itself as the HMAC key (rather than its decoded bytes) is a
 * common mistake that produces a signature imgproxy rejects; this was
 * caught and corrected during this plan's own verification against a
 * running imgproxy container.
 */
async function signImgproxyPath(path: string, key: string, salt: string): Promise<string> {
  const keyBytes = hexToBytes(key);
  const saltBytes = hexToBytes(salt);
  const message = new Uint8Array([...saltBytes, ...new TextEncoder().encode(path)]);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, message);
  return Buffer.from(signature).toString("base64url");
}

/**
 * Builds a fully-signed imgproxy URL for a media object. `objectKey` is a
 * relative path within the media bucket (e.g. "campaigns/covers/x.jpg"),
 * never a full URL -- see this plan's Global Constraints for why the
 * database only ever stores the key, not a full URL.
 */
export async function buildImgproxyUrl(
  objectKey: string,
  options: ImgproxyOptions,
): Promise<string> {
  const sourceUrl = `${options.sourceBaseUrl}/${objectKey}`;
  const encodedUrl = Buffer.from(sourceUrl).toString("base64url");
  const extension = objectKey.includes(".")
    ? objectKey.slice(objectKey.lastIndexOf(".") + 1)
    : "jpg";
  const processingOptions = `rs:fill:${options.resize.width}:${options.resize.height}:0`;
  const path = `/${processingOptions}/${encodedUrl}.${extension}`;
  const signature = await signImgproxyPath(path, options.key, options.salt);
  return `${options.baseUrl}/${signature}${path}`;
}
