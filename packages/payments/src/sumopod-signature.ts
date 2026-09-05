/**
 * Verifies a Sumopod webhook's svix-style signature. Mirrors this
 * package's own signature.ts (Midtrans's SHA-512 scheme) in spirit --
 * real HMAC verification via the Web Crypto API, not the "simpler"
 * X-Webhook-Token shared-secret shortcut Sumopod's docs also offer,
 * matching this codebase's established bar for webhook security.
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function computeHmacSha256Base64(
  secretBytes: Uint8Array<ArrayBuffer>,
  content: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return bytesToBase64(signature);
}

/**
 * Length-checked, byte-by-byte comparison rather than `===` -- same
 * rationale as signature.ts's own constantTimeEqual: don't leak timing
 * information about how much of the expected signature matched.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifySumopodSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string,
): Promise<boolean> {
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = await computeHmacSha256Base64(secretBytes, signedContent);

  // svix-signature may contain multiple space-separated "v1,<sig>" values
  // (this happens for ~24h after rotating the secret) -- check all of them,
  // not just the first.
  const candidates = svixSignature
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter((s): s is string => Boolean(s));

  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}
