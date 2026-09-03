// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

const REQUESTED_DISBURSEMENT = {
  id: "11111111-1111-1111-1111-111111111111",
  campaignId: "22222222-2222-2222-2222-222222222222",
  campaignTitle: "Bantu Aldi Sembuh",
  type: "partial" as const,
  amount: { amount: "500000", currency: "IDR" as const },
  status: "requested" as const,
  createdAt: new Date().toISOString(),
};

const APPROVED_DISBURSEMENT = {
  ...REQUESTED_DISBURSEMENT,
  id: "33333333-3333-3333-3333-333333333333",
  status: "approved" as const,
};

describe("(admin) /disbursements rendering", () => {
  test("with no disbursements, shows an empty state", () => {
    render(Page, { props: { params: {}, form: null, data: { disbursements: [] } } });
    expect(screen.getByText(/Tidak ada pencairan/)).not.toBeNull();
  });

  test("lists requested disbursements with campaign title, type, amount and Approve/Reject buttons", () => {
    render(Page, {
      props: { params: {}, form: null, data: { disbursements: [REQUESTED_DISBURSEMENT] } },
    });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Pencairan Sebagian")).not.toBeNull();
    expect(screen.getByText("Rp500.000")).not.toBeNull();
    expect(screen.getByText("Setujui")).not.toBeNull();
    expect(screen.getByText("Tolak")).not.toBeNull();
    expect(screen.queryByText("Bayar")).toBeNull();
  });

  test("approved disbursements show only a Pay button", () => {
    render(Page, {
      props: { params: {}, form: null, data: { disbursements: [APPROVED_DISBURSEMENT] } },
    });
    expect(screen.getByText("Bayar")).not.toBeNull();
    expect(screen.queryByText("Setujui")).toBeNull();
    expect(screen.queryByText("Tolak")).toBeNull();
  });

  test("clicking Approve calls the approve endpoint and removes the row", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "approved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { params: {}, form: null, data: { disbursements: [REQUESTED_DISBURSEMENT] } },
    });
    await fireEvent.click(screen.getByText("Setujui"));

    await waitFor(() => {
      expect(screen.queryByText("Bantu Aldi Sembuh")).toBeNull();
    });
    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toContain(
      `/admin/disbursements/${REQUESTED_DISBURSEMENT.id}/approve`,
    );
  });

  test("clicking Reject prompts for and sends a reason", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Dokumen tidak lengkap");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "rejected" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { params: {}, form: null, data: { disbursements: [REQUESTED_DISBURSEMENT] } },
    });
    await fireEvent.click(screen.getByText("Tolak"));

    await waitFor(() => {
      expect(screen.queryByText("Bantu Aldi Sembuh")).toBeNull();
    });
    expect(promptSpy).toHaveBeenCalled();
    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toContain(
      `/admin/disbursements/${REQUESTED_DISBURSEMENT.id}/reject`,
    );
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ reason: "Dokumen tidak lengkap" }),
    );
  });

  test("cancelling the reject prompt sends no request", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(Page, {
      props: { params: {}, form: null, data: { disbursements: [REQUESTED_DISBURSEMENT] } },
    });
    await fireEvent.click(screen.getByText("Tolak"));

    expect(promptSpy).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
  });

  test("clicking Pay calls the pay endpoint and removes the row", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "paid" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { params: {}, form: null, data: { disbursements: [APPROVED_DISBURSEMENT] } },
    });
    await fireEvent.click(screen.getByText("Bayar"));

    await waitFor(() => {
      expect(screen.queryByText("Bantu Aldi Sembuh")).toBeNull();
    });
    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toContain(
      `/admin/disbursements/${APPROVED_DISBURSEMENT.id}/pay`,
    );
  });

  test("when approve API fails, error message renders and row stays in list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_disbursement_status" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { params: {}, form: null, data: { disbursements: [REQUESTED_DISBURSEMENT] } },
    });
    await fireEvent.click(screen.getByText("Setujui"));

    await waitFor(() => {
      expect(screen.getByText("Gagal menyetujui pencairan.")).not.toBeNull();
    });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
  });
});
