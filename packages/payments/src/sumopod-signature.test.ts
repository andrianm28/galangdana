import { describe, expect, test } from "bun:test";
import { verifySumopodSignature } from "./sumopod-signature";

const SECRET = "whsec_dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz"; // "test-secret-key-for-unit-tests" base64
const SVIX_ID = "msg_test123";
const SVIX_TIMESTAMP = "1700000000";
const RAW_BODY = JSON.stringify({ event_type: "payment.completed", data: { order_id: "x" } });

// Uses the same Web Crypto API as sumopod-signature.ts itself -- not
// node:crypto -- so this test is computing the signature the exact same
// way the real verification will, just independently (a self-consistency
// check would be worthless if both sides used a different HMAC
// implementation and happened to agree by coincidence).
async function computeSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
) {
  function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const secretBytes = base64ToBytes(secret.replace(/^whsec_/, ""));
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return `v1,${sig}`;
}

describe("verifySumopodSignature", () => {
  test("accepts a correctly computed signature", async () => {
    const sig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, sig, RAW_BODY)).toBe(true);
  });

  test("rejects a tampered body", async () => {
    const sig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    const tamperedBody = JSON.stringify({
      event_type: "payment.completed",
      data: { order_id: "y" },
    });
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, sig, tamperedBody)).toBe(
      false,
    );
  });

  test("rejects a wrong secret", async () => {
    const sig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    const wrongSecret = "whsec_d3Jvbmctc2VjcmV0LWtleS1mb3ItdGVzdHM=";
    expect(await verifySumopodSignature(wrongSecret, SVIX_ID, SVIX_TIMESTAMP, sig, RAW_BODY)).toBe(
      false,
    );
  });

  test("accepts when the correct signature is one of several space-separated candidates", async () => {
    const correctSig = await computeSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, RAW_BODY);
    const decoySig = "v1,bm90LXRoZS1yaWdodC1zaWduYXR1cmU=";
    const combined = `${decoySig} ${correctSig}`;
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, combined, RAW_BODY)).toBe(
      true,
    );
  });

  test("rejects when no candidate matches", async () => {
    const decoySig = "v1,bm90LXRoZS1yaWdodC1zaWduYXR1cmU=";
    expect(await verifySumopodSignature(SECRET, SVIX_ID, SVIX_TIMESTAMP, decoySig, RAW_BODY)).toBe(
      false,
    );
  });
});
