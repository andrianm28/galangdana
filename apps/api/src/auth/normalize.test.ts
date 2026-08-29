import { describe, expect, test } from "bun:test";
import { normalizeEmail, normalizePhone } from "./normalize";

describe("normalizePhone", () => {
  test("all four respellings of one handset collapse to the same canonical form", () => {
    // These are the exact four spellings the final whole-branch review used
    // to prove the 3/hour per-phone OTP cap was bypassable: each was its own
    // Redis rate-limit key (12 accepted sends against a limit of 3).
    const spellings = ["+6281100777001", "081100777001", "6281100777001", "+62 81100777001"];
    for (const spelling of spellings) {
      expect(normalizePhone(spelling)).toBe("+6281100777001");
    }
  });

  test("strips stray spaces and dashes", () => {
    expect(normalizePhone("0811-0077-7001")).toBe("+6281100777001");
    expect(normalizePhone("  +62 811 0077 7001  ")).toBe("+6281100777001");
  });

  test("returns null for input that isn't a plausible Indonesian mobile number", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("not-a-phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    // Right prefix, but too short / too long to be a real mobile number.
    expect(normalizePhone("+62812")).toBeNull();
    expect(normalizePhone("+628111111111111111")).toBeNull();
    // Indonesian landline (area code 21), not a mobile number (8x).
    expect(normalizePhone("0215551234")).toBeNull();
  });

  test("accepts the shortest and longest plausible mobile lengths", () => {
    expect(normalizePhone("081234567")).toBe("+6281234567");
    expect(normalizePhone("08123456789012")).toBe("+628123456789012");
  });
});

describe("normalizeEmail", () => {
  test("lowercases and trims", () => {
    expect(normalizeEmail("  Case.Probe@Example.test  ")).toBe("case.probe@example.test");
    expect(normalizeEmail("ALREADY@LOWER.TEST")).toBe("already@lower.test");
    expect(normalizeEmail("already@lower.test")).toBe("already@lower.test");
  });
});
