// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import KycUploadPage from "./kyc-upload-page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const KYC = {
  campaignId: "11111111-1111-1111-1111-111111111111",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  campaignStatus: "draft",
  fullName: "Aldi Setiawan",
  nationalId: "3271234567890001",
  dateOfBirth: "1990-05-12",
  address: "Jl. Merdeka No. 1",
  city: "Bandung",
  postalCode: "40111",
  ktpObjectKey: null,
  selfieObjectKey: null,
  consentedAt: null,
};

describe("kyc-upload-page", () => {
  test("shows the correct heading for ktp vs selfie", () => {
    const { unmount } = render(KycUploadPage, {
      props: {
        data: { kyc: KYC },
        documentType: "ktp",
        stepName: "upload-ktp",
        heading: "Unggah Foto KTP",
      },
    });
    expect(screen.getByText("Unggah Foto KTP")).not.toBeNull();
    unmount();

    render(KycUploadPage, {
      props: {
        data: { kyc: KYC },
        documentType: "selfie",
        stepName: "upload-selfie",
        heading: "Unggah Foto Selfie",
      },
    });
    expect(screen.getByText("Unggah Foto Selfie")).not.toBeNull();
  });

  test("shows an already-uploaded indicator when the corresponding objectKey is present", () => {
    render(KycUploadPage, {
      props: {
        data: { kyc: { ...KYC, ktpObjectKey: "kyc/x/ktp/y.jpg" } },
        documentType: "ktp",
        stepName: "upload-ktp",
        heading: "Unggah Foto KTP",
      },
    });
    expect(screen.getByText(/sudah diunggah/)).not.toBeNull();
  });
});
