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

describe("kyc contact step rendering", () => {
  test("renders empty fields by default", () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    expect((screen.getByLabelText("Alamat") as HTMLTextAreaElement).value).toBe("");
  });

  test("pre-fills from existing saved contact data", () => {
    render(Page, {
      props: {
        data: {
          kyc: { ...KYC, address: "Jl. Merdeka No. 1", city: "Bandung", postalCode: "40111" },
        },
        params: { campaignId: KYC.campaignId },
      },
    });
    expect((screen.getByLabelText("Kota") as HTMLInputElement).value).toBe("Bandung");
  });
});
