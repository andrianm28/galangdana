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
          // Deliberately different from order_id below -- Sumopod's own
          // internal payment id is NOT what createCharge should return as
          // providerOrderId (see sumopod-provider.ts's comment); using the
          // same value for both here would let a regression of that bug
          // pass silently.
          payment_id: "sumopod-internal-payment-id-999",
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
      // Our own orderId, NOT the mock server's payment_id -- this is the
      // value parseWebhook's providerOrderId must later agree with (see
      // "correctly correlates createCharge's providerOrderId with a
      // matching parseWebhook event" below).
      providerOrderId: "INV-2026-001",
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

  test("rejects within a bounded time when the request hangs, instead of hanging indefinitely", async () => {
    server = Bun.serve({
      port: 0,
      async fetch() {
        // Deliberately longer than the provider's own configured timeout
        // below, simulating a sandbox that hangs rather than erroring --
        // without AbortSignal.timeout wired through createCharge, this
        // call would hang for the full duration instead of rejecting.
        await new Promise((resolve) => setTimeout(resolve, 500));
        return Response.json({
          payment_id: "sumopod-internal-payment-id-timeout",
          order_id: "INV-2026-TIMEOUT-001",
          payment_link_url: "https://pay.sumopod.com/pay/timeout",
          expires_at: new Date().toISOString(),
        });
      },
    });

    const provider = new SumopodProvider({
      apiKey: "test-api-key",
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: `http://localhost:${server.port}`,
      timeoutMs: 50,
    });

    const start = Date.now();
    await expect(
      provider.createCharge({
        orderId: "INV-2026-TIMEOUT-001",
        grossAmount: 10000n,
        currency: "IDR",
      }),
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(500);
  });

  test("createCharge's providerOrderId matches what parseWebhook later extracts for the same payment", async () => {
    // Regression coverage for a real bug: createCharge used to return
    // Sumopod's own payment_id as providerOrderId, while parseWebhook reads
    // providerOrderId from the webhook's order_id -- two DIFFERENT values
    // from Sumopod's API, so apps/api's `payments.providerOrderId` lookup
    // would never match a real webhook delivery. Sumopod's payment_id is
    // deliberately distinct from order_id in both the createCharge response
    // and the webhook payload below, so this test only passes if both sides
    // genuinely correlate via orderId -- not by test-construction coincidence.
    server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          payment_id: "sumopod-internal-payment-id-777",
          order_id: "INV-2026-CORR-001",
          amount: 25000,
          fee: 375,
          net_amount: 24625,
          payment_link_url: "https://pay.sumopod.com/pay/corr-001",
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

    const charge = await provider.createCharge({
      orderId: "INV-2026-CORR-001",
      grossAmount: 25000n,
      currency: "IDR",
    });

    const rawBody = webhookRequest(
      "payment.completed",
      "INV-2026-CORR-001",
      "sumopod-internal-payment-id-777",
    );
    const svixId = "msg_corr_1";
    const svixTimestamp = "1700000000";
    const sig = await computeSignature(WEBHOOK_SECRET, svixId, svixTimestamp, rawBody);
    const req = new Request("http://localhost/webhooks/sumopod", {
      method: "POST",
      headers: { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": sig },
      body: rawBody,
    });
    const event = await provider.parseWebhook(req);

    expect(event.providerOrderId).toBe(charge.providerOrderId);
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

  test("a validly-signed payment.test event throws SumopodTestEventError, not a mis-mapped 'failed' status", async () => {
    // Sumopod's dashboard "Save & Test" button sends this event to confirm
    // the webhook URL is reachable -- it carries no real order to
    // process, and may not even include a `data.order_id`. Before this
    // fix, the status ternary had no case for it and silently fell
    // through to "failed", which apps/api's processPaymentWebhookEvent
    // would then crash on (unmatched providerOrderId).
    const rawBody = JSON.stringify({
      event_type: "payment.test",
      data: { message: "Test webhook from Sumopod dashboard" },
    });
    const svixId = "msg_5";
    const svixTimestamp = "1700000000";
    const sig = await computeSignature(WEBHOOK_SECRET, svixId, svixTimestamp, rawBody);
    const req = new Request("http://localhost/webhooks/sumopod", {
      method: "POST",
      headers: { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": sig },
      body: rawBody,
    });

    await expect(provider.parseWebhook(req)).rejects.toThrow(/payment\.test/);
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
