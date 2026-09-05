// @vitest-environment happy-dom
import type { DisbursementDetailResponse } from "@fundforindonesia/contracts";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

beforeEach(() => {
  goto.mockClear();
});

const PARAMS = { id: "c1", disbursementId: "d1" };

const DISBURSEMENT: DisbursementDetailResponse = {
  id: "d1",
  campaignId: "c1",
  bankAccountId: "ba1",
  type: "partial",
  amount: { amount: "100000", currency: "IDR" },
  narrative: "Untuk biaya pengobatan",
  proofObjectKey: "disbursements/d1/proof/abc.pdf",
  status: "otp_pending",
  otpVerifiedAt: new Date().toISOString(),
  rejectedReason: null,
  payoutRef: null,
  paidAt: null,
  withdrawableAmount: { amount: "500000", currency: "IDR" },
};

function renderPage() {
  return render(Page, {
    props: {
      data: { disbursement: DISBURSEMENT },
      params: PARAMS,
      form: null,
    },
  });
}

describe("pencairan/summary page", () => {
  test("renders the loaded fields", () => {
    renderPage();
    expect(screen.getByText("Pencairan Sebagian")).not.toBeNull();
    expect(screen.getByText("Rp100000")).not.toBeNull();
    expect(screen.getByText("Untuk biaya pengobatan")).not.toBeNull();
  });

  test("a successful submit navigates to the in-process step", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/submit") && method === "POST") {
        return new Response(JSON.stringify({ status: "requested" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    renderPage();

    await fireEvent.click(screen.getByRole("button", { name: "Ajukan Pencairan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(goto).toHaveBeenCalledWith("/dashboard/campaigns/c1/pencairan/d1/in-process");
    fetchSpy.mockRestore();
  });

  test("a failed submit shows the error message and does not navigate", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/submit") && method === "POST") {
        return new Response(JSON.stringify({ error: "otp_not_verified" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    renderPage();

    await fireEvent.click(screen.getByRole("button", { name: "Ajukan Pencairan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(
      screen.getByText("Gagal mengajukan pencairan. Pastikan Anda sudah memverifikasi OTP."),
    ).not.toBeNull();
    expect(goto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
