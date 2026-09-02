import { describe, expect, test } from "vitest";
import { getStepOrder, nextStep, previousStep } from "./step-order";

describe("step-order", () => {
  test("medical track order", () => {
    expect(getStepOrder("medical")).toEqual([
      "tujuan",
      "judul",
      "target-donasi",
      "cerita",
      "ajakan",
      "pasien",
      "dokumen",
      "otp",
      "rangkuman",
    ]);
  });

  test("non_medical track order", () => {
    expect(getStepOrder("non_medical")).toEqual([
      "data-diri",
      "tujuan",
      "judul",
      "target-donasi",
      "cerita",
      "ajakan",
      "penerima",
      "dokumen",
      "otp",
      "rangkuman",
    ]);
  });

  test("nextStep returns the following step, or null at the end", () => {
    expect(nextStep("medical", "tujuan")).toBe("judul");
    expect(nextStep("medical", "rangkuman")).toBeNull();
  });

  test("previousStep returns the prior step, or null at the start", () => {
    expect(previousStep("non_medical", "tujuan")).toBe("data-diri");
    expect(previousStep("medical", "tujuan")).toBeNull();
  });
});
