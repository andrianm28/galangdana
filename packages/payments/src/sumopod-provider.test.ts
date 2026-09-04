import { afterEach, describe, expect, test } from "bun:test";
import { SumopodProvider } from "./sumopod-provider";

const WEBHOOK_SECRET = "whsec_dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz"; // "test-secret-key-for-unit-tests" base64

// Independently computes a valid svix-style signature -- mirrors
// sumopod-signature.test.ts's own local helper rather than importing
// sumopod-signature.ts's internals, so this test doesn't just check that
// the module agrees with itself.
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

function webhookRequest(eventType: string, orderId: string, paymentId: string, body?: string) {
  const rawBody =
    body ??
    JSON.stringify({
      event_type: eventType,
      data: {
        payment_id: paymentId,
        order_id: orderId,
        amount: 50000,
        fee: 750,
        net_amount: 49250,
        status: eventType === "payment.completed" ? "completed" : "failed",
        payment_method: "qris",
        completed_at: "2026-06-18T12:00:00Z",
      },
    });
  return rawBody;
}

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("SumopodProvider.createCharge", () => {
  test("sends the right request shape and maps the response to a qris_redirect charge", async () => {
    let capturedRequest: { method: string; headers: Headers; body: unknown } | undefined;

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedRequest = {
          method: req.method,
          headers: req.headers,
          body: await req.json(),
        };
        return Response.json({
          payment_id: "11111111-1111-1111-1111-111111111111",
          order_id: "INV-2026-001",
          amount: 50000,
          fee: 750,
          net_amount: 49250,
          payment_link_url: "https://pay.sumopod.com/pay/11111111-1111-1111-1111-111111111111",
          status: "pending",
          expires_at: "2026-01-01T12:00:00Z",
        });
      },
    });

    const provider = new SumopodProvider({
      apiKey: "test-api-key",
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: `http://localhost:${server.port}`,
    });

    const result = await provider.createCharge({
      orderId: "INV-2026-001",
      grossAmount: 50000n,
      currency: "IDR",
      successReturnUrl: "https://yourapp.com/success",
      cancelReturnUrl: "https://yourapp.com/cancel",
    });

    expect(capturedRequest?.method).toBe("POST");
    expect(capturedRequest?.headers.get("x-api-key")).toBe("test-api-key");
    expect(capturedRequest?.headers.get("content-type")).toBe("application/json");
    expect(capturedRequest?.body).toEqual({
      order_id: "INV-2026-001",
      amount: 50000,
      currency: "IDR",
      expires_in_hours: 24,
      success_return_url: "https://yourapp.com/success",
      cancel_return_url: "https://yourapp.com/cancel",
      payment_method_type_code: "QRIS",
    });

    expect(result).toEqual({
      providerOrderId: "11111111-1111-1111-1111-111111111111",
      method: "qris_redirect",
      redirectUrl: "https://pay.sumopod.com/pay/11111111-1111-1111-1111-111111111111",
      expiresAt: new Date("2026-01-01T12:00:00Z"),
    });
  });

  test("throws with the status and body when Sumopod returns a non-2xx response", async () => {
    server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("invalid api key", { status: 401 });
      },
    });

    const provider = new SumopodProvider({
      apiKey: "bad-key",
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: `http://localhost:${server.port}`,
    });

    await expect(
      provider.createCharge({ orderId: "INV-2026-002", grossAmount: 10000n, currency: "IDR" }),
    ).rejects.toThrow(/401/);
  });
});

describe("SumopodProvider.parseWebhook", () => {
  const provider = new SumopodProvider({ apiKey: "test-api-key", webhookSecret: WEBHOOK_SECRET });

  test("a validly-signed payment.completed body maps to status: paid", async () => {
    const rawBody = webhookRequest("payment.completed", "INV-2026-001", "pay-1");
    const svixId = "msg_1";
    const svixTimestamp = "1700000000";
    const sig = await computeSignature(WEBHOOK_SECRET, svixId, svixTimestamp, rawBody);

    const req = new Request("http://localhost/webhooks/sumopod", {
      method: "POST",
      headers: { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": sig },
      body: rawBody,
    });

    const event = await provider.parseWebhook(req);
    expect(event.provider).toBe("sumopod");
    expect(event.status).toBe("paid");
    expect(event.providerOrderId).toBe("INV-2026-001");
    expect(event.providerEventId).toBe("pay-1:payment.completed");
  });

  test("throws on an invalid signature", async () => {
    const rawBody = webhookRequest("payment.completed", "INV-2026-001", "pay-2");
    const req = new Request("http://localhost/webhooks/sumopod", {
      method: "POST",
      headers: {
        "svix-id": "msg_2",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,bm90LXRoZS1yaWdodC1zaWduYXR1cmU=",
      },
      body: rawBody,
    });

    await expect(provider.parseWebhook(req)).rejects.toThrow(/signature/i);
  });

  test("maps payment.failed to status: failed", async () => {
    const rawBody = webhookRequest("payment.failed", "INV-2026-003", "pay-3");
    const svixId = "msg_3";
    const svixTimestamp = "1700000000";
    const sig = await computeSignature(WEBHOOK_SECRET, svixId, svixTimestamp, rawBody);
    const req = new Request("http://localhost/webhooks/sumopod", {
      method: "POST",
      headers: { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": sig },
      body: rawBody,
    });

    const event = await provider.parseWebhook(req);
    expect(event.status).toBe("failed");
  });

  test("maps payment.expired to status: expired", async () => {
    const rawBody = webhookRequest("payment.expired", "INV-2026-004", "pay-4");
    const svixId = "msg_4";
    const svixTimestamp = "1700000000";
    const sig = await computeSignature(WEBHOOK_SECRET, svixId, svixTimestamp, rawBody);
    const req = new Request("http://localhost/webhooks/sumopod", {
      method: "POST",
      headers: { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": sig },
      body: rawBody,
    });

    const event = await provider.parseWebhook(req);
    expect(event.status).toBe("expired");
  });
});

describe("SumopodProvider not-yet-implemented methods", () => {
  const provider = new SumopodProvider({ apiKey: "test-api-key", webhookSecret: WEBHOOK_SECRET });

  test("getStatus throws with a clear message", async () => {
    await expect(provider.getStatus("INV-2026-001")).rejects.toThrow(/not implemented/i);
  });

  test("createPayout throws with a clear message", async () => {
    await expect(
      provider.createPayout({
        referenceId: "disb-1",
        amount: 100_000n,
        channelCode: "ID_BCA",
        accountNumber: "1234567890",
        accountHolderName: "Test Campaigner",
        description: "Pencairan dana kampanye",
      }),
    ).rejects.toThrow(/not implemented/i);
  });
});
