// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const DETAIL = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "bantu-aldi-sembuh",
  title: "Bantu Aldi Sembuh",
  shortDescription: "Butuh biaya operasi.",
  story: "Cerita lengkap di sini.",
  status: "pending_review",
  model: "goal" as const,
  goalAmount: { amount: "5000000", currency: "IDR" as const },
  category: { id: 1, slug: "bantuan-medis", title: "Bantuan Medis" },
  campaignerName: "Aldi Setiawan",
  verification: {
    fullName: "Aldi Setiawan",
    nationalId: "3271234567890001",
    dateOfBirth: "1990-05-12",
    address: "Jl. Merdeka No. 1",
    city: "Bandung",
    postalCode: "40111",
    ktpViewUrl: "http://localhost:9000/campaign-documents/kyc/x/ktp/y.jpg?signed=1",
    selfieViewUrl: "http://localhost:9000/campaign-documents/kyc/x/selfie/z.jpg?signed=1",
    status: "pending",
  },
  documents: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      type: "kartu_mahasiswa",
      viewUrl: "http://localhost:9000/campaign-documents/kartu_mahasiswa/y.jpg?signed=1",
      uploadedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  revisions: [],
};

describe("admin campaign review page", () => {
  test("shows campaign content and KYC identity fields", () => {
    render(Page, { props: { data: { campaign: DETAIL }, params: { id: DETAIL.id }, form: null } });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("3271234567890001")).not.toBeNull();
    expect(screen.getByText("Aldi Setiawan")).not.toBeNull();
  });

  test("renders a link for each presigned supporting document", () => {
    render(Page, { props: { data: { campaign: DETAIL }, params: { id: DETAIL.id }, form: null } });
    const link = screen.getByRole("link", { name: "Kartu Mahasiswa" });
    expect(link.getAttribute("href")).toBe(DETAIL.documents[0]?.viewUrl);
  });

  test("clicking Setujui approves and navigates back to the queue", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "active" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { data: { campaign: DETAIL }, params: { id: DETAIL.id }, form: null } });
    await fireEvent.click(screen.getByRole("button", { name: "Setujui" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith("/dashboard");
    fetchSpy.mockRestore();
  });

  test("submitting a revision request with a note calls the request-revision action", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "needs_revision" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { data: { campaign: DETAIL }, params: { id: DETAIL.id }, form: null } });
    await fireEvent.click(screen.getByLabelText("Cerita"));
    await fireEvent.input(screen.getByLabelText("Catatan untuk Cerita"), {
      target: { value: "Cerita terlalu singkat." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Minta Revisi" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith("/dashboard");
    fetchSpy.mockRestore();
  });
});
