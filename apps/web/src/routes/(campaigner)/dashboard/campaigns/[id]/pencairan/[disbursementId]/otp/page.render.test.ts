// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

vi.mock("$app/state", () => ({
  page: {
    url: new URL("http://localhost/dashboard/campaigns/c1/pencairan/d1/otp"),
    params: { id: "c1", disbursementId: "d1" },
  },
}));

beforeEach(() => {
  goto.mockClear();
});

function renderPage() {
  return render(Page);
}

describe("pencairan/otp page", () => {
  test("Kirim Kode requests an OTP and reveals the code input", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/otp/request") && method === "POST") {
        return new Response(JSON.stringify({ sent: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    renderPage();

    expect(screen.queryByLabelText("Kode OTP")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Kirim Kode" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByLabelText("Kode OTP")).not.toBeNull();
    fetchSpy.mockRestore();
  });

  test("a non-verified otp/verify response shows the error and does not navigate", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/otp/request") && method === "POST") {
        return new Response(JSON.stringify({ sent: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/disbursements/d1/otp/verify") && method === "POST") {
        const body = JSON.parse(init?.body as string) as { code: string };
        expect(body).toEqual({ code: "000000" });
        return new Response(JSON.stringify({ verified: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    renderPage();

    await fireEvent.click(screen.getByRole("button", { name: "Kirim Kode" }));
    await new Promise((r) => setTimeout(r, 0));

    await fireEvent.input(screen.getByLabelText("Kode OTP"), {
      target: { value: "000000" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Verifikasi" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText("Kode OTP salah atau kedaluwarsa.")).not.toBeNull();
    expect(goto).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("a successful otp/verify navigates to the summary step", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/disbursements/d1/otp/request") && method === "POST") {
        return new Response(JSON.stringify({ sent: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/disbursements/d1/otp/verify") && method === "POST") {
        const body = JSON.parse(init?.body as string) as { code: string };
        expect(body).toEqual({ code: "123456" });
        return new Response(JSON.stringify({ verified: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call: ${method} ${url}`);
    });

    renderPage();

    await fireEvent.click(screen.getByRole("button", { name: "Kirim Kode" }));
    await new Promise((r) => setTimeout(r, 0));

    await fireEvent.input(screen.getByLabelText("Kode OTP"), {
      target: { value: "123456" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Verifikasi" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(goto).toHaveBeenCalledWith("/dashboard/campaigns/c1/pencairan/d1/summary");
    fetchSpy.mockRestore();
  });
});
