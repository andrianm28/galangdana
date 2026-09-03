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
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) campaign/[slug]/contribute rendering", () => {
  test("submitting creates a donation and redirects to the status page", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          donationId: "11111111-1111-1111-1111-111111111111",
          vaNumber: "88012345678901",
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
