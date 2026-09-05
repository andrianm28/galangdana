// @vitest-environment happy-dom
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: {
    url: new URL("http://localhost/campaign/test-campaign/contribute?amount=50000"),
    params: { slug: "test-campaign" },
  },
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("(consumer) campaign/[slug]/contribute rendering", () => {
  test("a bank_transfer_va submission creates a donation and redirects to the status page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          donationId: "11111111-1111-1111-1111-111111111111",
          method: "bank_transfer_va",
          vaNumber: "88012345678901",
          redirectUrl: null,
          amount: { amount: "50000", currency: "IDR" },
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { goto } = await import("$app/navigation");

    render(Page, {
      props: {
        params: { slug: "test-campaign" },
        data: { campaign: { id: "test-campaign-id" } },
        form: null,
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Konfirmasi Donasi" }));

    await waitFor(() => {
      expect(goto).toHaveBeenCalledWith("/donation/status/11111111-1111-1111-1111-111111111111");
    });
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
      "idempotency-key": expect.any(String),
    });
  });

  test("a qris_redirect submission creates a donation and redirects to Sumopod's hosted payment page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          donationId: "22222222-2222-2222-2222-222222222222",
          method: "qris_redirect",
          vaNumber: null,
          redirectUrl: "https://pay.sumopod.com/checkout/abc123",
          amount: { amount: "50000", currency: "IDR" },
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { goto } = await import("$app/navigation");

    render(Page, {
      props: {
        params: { slug: "test-campaign" },
        data: { campaign: { id: "test-campaign-id" } },
        form: null,
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Konfirmasi Donasi" }));

    await waitFor(() => {
      expect(window.location.href).toBe("https://pay.sumopod.com/checkout/abc123");
    });
    expect(goto).not.toHaveBeenCalled();
  });

  test("shows an error message if the donation request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "campaign_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    render(Page, {
      props: {
        params: { slug: "test-campaign" },
        data: { campaign: { id: "test-campaign-id" } },
        form: null,
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Konfirmasi Donasi" }));
    await waitFor(() => {
      expect(screen.getByText(/Gagal memproses donasi/)).not.toBeNull();
    });
  });
});
