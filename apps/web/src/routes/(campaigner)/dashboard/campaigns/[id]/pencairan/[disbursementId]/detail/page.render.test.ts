// @vitest-environment happy-dom
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

const DISBURSEMENT = {
  id: "d1",
  campaignId: "c1",
  bankAccountId: "ba1",
  type: null,
  amount: null,
  narrative: null,
  proofObjectKey: "disbursements/d1/proof/abc.pdf",
  status: "draft" as const,
  otpVerifiedAt: null,
  rejectedReason: null,
  payoutRef: null,
  paidAt: null,
  withdrawableAmount: { amount: "500000", currency: "IDR" as const },
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

describe("pencairan/detail page", () => {
  test("renders the withdrawable balance from data", () => {
    renderPage();
    expect(screen.getByText("Saldo dapat dicairkan: Rp500000")).not.toBeNull();
  });

  test("an invalid amount blocks submission with a local validation message and makes no fetch call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    renderPage();

    await fireEvent.input(screen.getByLabelText("Nominal Pencairan"), {
      target: { value: "0" },
    });
    await fireEvent.input(screen.getByLabelText("Keterangan Penggunaan Dana"), {
      target: { value: "Untuk biaya pengobatan" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Masukkan nominal yang valid.")).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("a PATCH response with amount_exceeds_withdrawable_balance renders that specific message", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/detail") && method === "PATCH") {
        return new Response(JSON.stringify({ error: "amount_exceeds_withdrawable_balance" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    renderPage();

    await fireEvent.input(screen.getByLabelText("Nominal Pencairan"), {
      target: { value: "999999999" },
    });
    await fireEvent.input(screen.getByLabelText("Keterangan Penggunaan Dana"), {
      target: { value: "Untuk biaya pengobatan" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Nominal melebihi saldo yang dapat dicairkan.")).not.toBeNull();
    expect(goto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("a successful PATCH navigates to the otp step", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/detail") && method === "PATCH") {
        const body = JSON.parse(init?.body as string) as {
          type: string;
          amountStr: string;
          narrative: string;
        };
        expect(body).toEqual({
          type: "partial",
          amountStr: "100000",
          narrative: "Untuk biaya pengobatan",
        });
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    renderPage();

    await fireEvent.input(screen.getByLabelText("Nominal Pencairan"), {
      target: { value: "100000" },
    });
    await fireEvent.input(screen.getByLabelText("Keterangan Penggunaan Dana"), {
      target: { value: "Untuk biaya pengobatan" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(goto).toHaveBeenCalledWith("/dashboard/campaigns/c1/pencairan/d1/otp");
    fetchSpy.mockRestore();
  });
});
