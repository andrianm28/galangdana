import { describe, expect, test } from "bun:test";
import { MockPaymentProvider } from "./mock-provider";

describe("MockPaymentProvider", () => {
  test("createCharge returns a VA number and a real provider order id", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    const result = await provider.createCharge({
      orderId: "donation-order-1",
      grossAmount: 50000n,
      currency: "IDR",
    });
    expect(result.vaNumber).toMatch(/^\d{10,16}$/);
    expect(result.providerOrderId).toBe("donation-order-1");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("simulateWebhookPayload produces a payload that verifies against the same provider's server key", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    const charge = await provider.createCharge({
      orderId: "donation-order-2",
      grossAmount: 75000n,
      currency: "IDR",
    });
    const payload = await provider.simulateWebhookPayload(charge.providerOrderId, 75000n);
    const req = new Request("http://localhost/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const event = await provider.parseWebhook(req);
    expect(event.providerOrderId).toBe("donation-order-2");
    expect(event.status).toBe("paid");
  });

  test("parseWebhook throws on a bad signature", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    const charge = await provider.createCharge({
      orderId: "donation-order-3",
      grossAmount: 10000n,
      currency: "IDR",
    });
    const payload = await provider.simulateWebhookPayload(charge.providerOrderId, 10000n);
    const tamperedPayload = { ...payload, signature_key: "0".repeat(128) };
    const req = new Request("http://localhost/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tamperedPayload),
    });
    await expect(provider.parseWebhook(req)).rejects.toThrow(/signature/i);
  });

  test("createPayout returns a completed payout synchronously", async () => {
    const provider = new MockPaymentProvider({ serverKey: "test-key" });
    const result = await provider.createPayout({
      referenceId: "disb-123",
      amount: 500_000n,
      channelCode: "ID_BCA",
      accountNumber: "1234567890",
      accountHolderName: "Test Campaigner",
      description: "Pencairan dana kampanye",
    });
    expect(result.status).toBe("completed");
    expect(result.payoutId).toContain("disb-123");
  });
});
