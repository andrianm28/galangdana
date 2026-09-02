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
  ktpObjectKey: "kyc/x/ktp/y.jpg",
  selfieObjectKey: "kyc/x/selfie/z.jpg",
  consentedAt: null,
};

describe("kyc summary page rendering", () => {
  test("shows the collected identity/contact data", () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    expect(screen.getByText("Aldi Setiawan")).not.toBeNull();
    expect(screen.getByText("Bandung")).not.toBeNull();
  });

  test("disables the submit button when a document is missing", () => {
    render(Page, {
      props: {
        data: { kyc: { ...KYC, ktpObjectKey: null } },
        params: { campaignId: KYC.campaignId },
      },
    });
    const submitButton = screen.getByRole("button", {
      name: "Ajukan Campaign",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
  });

  test("enables the submit button when both documents are present", () => {
    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    const submitButton = screen.getByRole("button", {
      name: "Ajukan Campaign",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
  });

  test("clicking Ajukan Campaign submits and navigates to pending", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_review" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { data: { kyc: KYC }, params: { campaignId: KYC.campaignId } } });
    await fireEvent.click(screen.getByRole("button", { name: "Ajukan Campaign" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith(`/kyc/${KYC.campaignId}/step/pending`);
    fetchSpy.mockRestore();
  });
});
