import { describe, expect, test } from "bun:test";
import { computeMidtransSignature, verifyMidtransSignature } from "./signature";

const SERVER_KEY = "test-server-key-do-not-use-in-prod";

describe("Midtrans-style signature", () => {
  test("computes a deterministic SHA512 hex digest", async () => {
    const sig1 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "50000.00" },
      SERVER_KEY,
    );
    const sig2 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "50000.00" },
      SERVER_KEY,
    );
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{128}$/); // SHA512 hex = 128 chars
  });

  test("a different gross amount produces a different signature", async () => {
    const sig1 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "50000.00" },
      SERVER_KEY,
    );
    const sig2 = await computeMidtransSignature(
      { orderId: "order-1", statusCode: "200", grossAmount: "99999.00" },
      SERVER_KEY,
    );
    expect(sig1).not.toBe(sig2);
  });

  test("verifyMidtransSignature accepts a signature computed with the same inputs", async () => {
    const input = { orderId: "order-2", statusCode: "200", grossAmount: "10000.00" };
    const sig = await computeMidtransSignature(input, SERVER_KEY);
    expect(await verifyMidtransSignature(input, sig, SERVER_KEY)).toBe(true);
  });

  test("verifyMidtransSignature rejects a tampered signature", async () => {
    const input = { orderId: "order-3", statusCode: "200", grossAmount: "10000.00" };
    const sig = await computeMidtransSignature(input, SERVER_KEY);
    const tampered = `${sig.slice(0, -1)}${sig.at(-1) === "0" ? "1" : "0"}`;
    expect(await verifyMidtransSignature(input, tampered, SERVER_KEY)).toBe(false);
  });

  test("verifyMidtransSignature rejects a signature computed with the wrong server key", async () => {
    const input = { orderId: "order-4", statusCode: "200", grossAmount: "10000.00" };
    const sig = await computeMidtransSignature(input, "a-completely-different-key");
    expect(await verifyMidtransSignature(input, sig, SERVER_KEY)).toBe(false);
  });
});
