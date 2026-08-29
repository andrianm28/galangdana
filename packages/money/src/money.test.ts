import { describe, expect, test } from "bun:test";
import { addMoney, formatMoney, money, moneyFromJSON, moneyToJSON } from "./money";
import { bigIntSafeJSONStringify } from "./serializer";

describe("money", () => {
  test("constructs from bigint and normalizes number input", () => {
    expect(money(10_000n, "IDR")).toEqual({ amount: 10_000n, currency: "IDR" });
    expect(money(10_000, "IDR")).toEqual({ amount: 10_000n, currency: "IDR" });
  });

  test("addMoney sums same-currency amounts", () => {
    const a = money(30_000, "IDR");
    const b = money(70_000, "IDR");
    expect(addMoney(a, b)).toEqual({ amount: 100_000n, currency: "IDR" });
  });

  test("addMoney throws on currency mismatch", () => {
    const a = money(30_000, "IDR");
    const b = money(2_000, "USD");
    expect(() => addMoney(a, b)).toThrow(/currency mismatch/i);
  });

  test("formatMoney renders IDR with id-ID grouping and Rp prefix", () => {
    expect(formatMoney(money(1_180_879_232, "IDR"))).toBe("Rp1.180.879.232");
  });

  test("formatMoney renders USD cents as dollars with 2 decimals", () => {
    expect(formatMoney(money(2_000_000, "USD"))).toBe("$20,000.00");
  });

  test("round-trips through JSON without precision loss", () => {
    const original = money(9_007_199_254_740_993n, "IDR"); // exceeds Number.MAX_SAFE_INTEGER
    const json = moneyToJSON(original);
    expect(json).toEqual({ amount: "9007199254740993", currency: "IDR" });
    expect(moneyFromJSON(json)).toEqual(original);
  });
});

describe("bigIntSafeJSONStringify", () => {
  test("serializes bigint fields as strings instead of throwing", () => {
    const payload = { donationId: 42, amount: 1_180_879_232n, currency: "IDR" as const };
    expect(() => JSON.stringify(payload)).toThrow(/cannot serialize.*bigint/i);
    expect(bigIntSafeJSONStringify(payload)).toBe(
      '{"donationId":42,"amount":"1180879232","currency":"IDR"}',
    );
  });

  test("round-trips nested bigints inside arrays and objects", () => {
    const payload = { items: [{ amount: 5n }, { amount: 10n }] };
    expect(bigIntSafeJSONStringify(payload)).toBe('{"items":[{"amount":"5"},{"amount":"10"}]}');
  });
});
