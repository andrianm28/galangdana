import { describe, expect, test } from "vitest";
import { getKycStepOrder, nextKycStep, previousKycStep } from "./kyc-step-order";

describe("kyc-step-order", () => {
  test("full step order", () => {
    expect(getKycStepOrder()).toEqual([
      "identity",
      "contact",
      "consent",
      "upload-ktp",
      "upload-selfie",
      "hold",
      "summary",
      "pending",
    ]);
  });

  test("nextKycStep returns the following step, or null at the end", () => {
    expect(nextKycStep("identity")).toBe("contact");
    expect(nextKycStep("pending")).toBeNull();
  });

  test("previousKycStep returns the prior step, or null at the start", () => {
    expect(previousKycStep("contact")).toBe("identity");
    expect(previousKycStep("identity")).toBeNull();
  });

  test("nextKycStep and previousKycStep return null for an unrecognized step", () => {
    expect(nextKycStep("bogus")).toBeNull();
    expect(previousKycStep("bogus")).toBeNull();
  });
});
