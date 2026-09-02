// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const KYC = {
  campaignId: "11111111-1111-1111-1111-111111111111",
  campaignTitle: "Bantu Aldi Sembuh",
  campaignSlug: "bantu-aldi-sembuh",
  campaignStatus: "draft",
  fullName: null,
  nationalId: null,
  dateOfBirth: null,
  address: null,
  city: null,
  postalCode: null,
  ktpObjectKey: null,
  selfieObjectKey: null,
  consentedAt: null,
};

describe("kyc identity step rendering", () => {
  test("renders empty fields by default", () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    expect((screen.getByLabelText("Nama lengkap (sesuai KTP)") as HTMLInputElement).value).toBe("");
  });

  test("pre-fills from existing saved identity data", () => {
    render(Page, {
      props: {
        data: {
          kyc: {
            ...KYC,
            fullName: "Aldi Setiawan",
            nationalId: "3271234567890001",
            dateOfBirth: "1990-05-12",
          },
        },
        params: { campaignId: KYC.campaignId },
      },
    });
    expect((screen.getByLabelText("Nama lengkap (sesuai KTP)") as HTMLInputElement).value).toBe(
      "Aldi Setiawan",
    );
  });
});
