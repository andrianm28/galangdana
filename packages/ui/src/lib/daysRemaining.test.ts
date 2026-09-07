import { describe, expect, test } from "vitest";
import { daysRemaining } from "./daysRemaining";

describe("daysRemaining", () => {
  test("returns null when expiresAt is null (a program-model campaign has no deadline)", () => {
    expect(daysRemaining(null)).toBeNull();
  });

  test("returns the number of days remaining, rounded up to the next whole day", () => {
    const nineAndHalfDaysOut = new Date(Date.now() + 9.5 * 86400000).toISOString();
    expect(daysRemaining(nineAndHalfDaysOut)).toBe(10);
  });

  test("returns the exact day count for a deadline an even number of days out", () => {
    const tenDaysOut = new Date(Date.now() + 10 * 86400000).toISOString();
    expect(daysRemaining(tenDaysOut)).toBe(10);
  });

  test("never returns a negative number for a deadline that has already passed", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(daysRemaining(yesterday)).toBe(0);
  });
});
