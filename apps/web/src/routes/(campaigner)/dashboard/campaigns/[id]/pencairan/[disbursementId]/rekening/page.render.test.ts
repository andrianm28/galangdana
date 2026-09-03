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

const EXISTING_ACCOUNT = {
  id: "ba1",
  bankCode: "bca",
  bankName: "Bank Central Asia",
  accountNumber: "1234567890",
  accountHolderName: "Aldi Wijaya",
  verifiedAt: null,
};

describe("pencairan/rekening page", () => {
  test("selecting an existing account and clicking Lanjutkan PATCHes the disbursement and navigates to upload", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/bank-account") && method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    render(Page, {
      props: {
        data: { bankAccounts: [EXISTING_ACCOUNT] },
        params: PARAMS,
        form: null,
      },
    });

    const radio = screen.getByRole("radio");
    await fireEvent.click(radio);
    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    const patchCall = fetchSpy.mock.calls.find((call) =>
      (call[0] as string).toString().includes("/disbursements/d1/bank-account"),
    );
    expect(patchCall).toBeDefined();
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({
      bankAccountId: "ba1",
    });
    expect(goto).toHaveBeenCalledWith("/dashboard/campaigns/c1/pencairan/d1/upload");
    fetchSpy.mockRestore();
  });

  test("adding a new account POSTs it, then PATCHes the disbursement, then navigates", async () => {
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/bank-accounts") && method === "POST") {
        return new Response(JSON.stringify({ id: "ba2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/disbursements/d1/bank-account") && method === "PATCH") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    render(Page, {
      props: {
        data: { bankAccounts: [] },
        params: PARAMS,
        form: null,
      },
    });

    await fireEvent.input(screen.getByLabelText("Kode Bank"), { target: { value: "bca" } });
    await fireEvent.input(screen.getByLabelText("Nama Bank"), {
      target: { value: "Bank Central Asia" },
    });
    await fireEvent.input(screen.getByLabelText("Nomor Rekening"), {
      target: { value: "9876543210" },
    });
    await fireEvent.input(screen.getByLabelText("Nama Pemilik Rekening"), {
      target: { value: "Aldi Wijaya" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[0]).toMatch(/^POST .*\/bank-accounts$/);
    expect(calls[1]).toMatch(/^PATCH .*\/disbursements\/d1\/bank-account$/);
    expect(goto).toHaveBeenCalledWith("/dashboard/campaigns/c1/pencairan/d1/upload");
    fetchSpy.mockRestore();
  });

  test("submitting without an existing selection or a filled new-account form shows a validation error and does not navigate", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    render(Page, {
      props: {
        data: { bankAccounts: [] },
        params: PARAMS,
        form: null,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Pilih atau tambahkan rekening bank.")).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
