// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

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

describe("kyc consent step rendering", () => {
  test("Lanjutkan is disabled until the consent checkbox is checked", async () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    const nextButton = screen.getByRole("button", { name: "Lanjutkan" }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);

    await fireEvent.click(screen.getByRole("checkbox"));
    expect(nextButton.disabled).toBe(false);

    await fireEvent.click(nextButton);
    await new Promise((r) => setTimeout(r, 0));
    expect(goto).toHaveBeenCalledWith(`/kyc/${KYC.campaignId}/step/upload-ktp`);
  });
});
