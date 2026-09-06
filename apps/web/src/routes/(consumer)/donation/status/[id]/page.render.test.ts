// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

const invalidateAll = vi.fn();
vi.mock("$app/navigation", () => ({ invalidateAll: () => invalidateAll() }));

type Status = "pending" | "paid" | "expired" | "failed";
type Method = "bank_transfer_va" | "qris_redirect";

function donation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    campaignId: "c1",
    campaignTitle: "Kampanye Uji",
    campaignSlug: "kampanye-uji",
    displayName: null,
    amount: { amount: "50000", currency: "IDR" as const },
    status: "pending" as Status,
    method: "bank_transfer_va" as Method,
    vaNumber: "88012345678901",
    redirectUrl: null,
    expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    paidAt: null,
    ...overrides,
  };
}

function renderPage(overrides: Partial<Record<string, unknown>> = {}) {
  return render(Page, {
    props: { params: { id: "1" }, data: { donation: donation(overrides) }, form: null },
  });
}

beforeEach(() => {
  invalidateAll.mockClear();
  vi.useRealTimers();
});

describe("(consumer) donation/status/[id] — waiting for payment", () => {
  test("shows the VA number, the amount owed, and a copy control", () => {
    renderPage();
    expect(screen.getByText("88012345678901")).not.toBeNull();
    // The donor could not previously see what they were paying.
    expect(screen.getByText("Rp50.000")).not.toBeNull();
    // A 14-digit number is not something to retype into a banking app by hand.
    expect(screen.getByText("Salin nomor")).not.toBeNull();
  });

  test("copies the VA number to the clipboard and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is getter-only in happy-dom, so it is redefined
    // rather than assigned.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderPage();
    await fireEvent.click(screen.getByText("Salin nomor"));
    expect(writeText).toHaveBeenCalledWith("88012345678901");
    expect(screen.getByText("Nomor tersalin")).not.toBeNull();
  });

  test("shows how long is left to pay", () => {
    renderPage();
    expect(screen.getByText(/Selesaikan dalam/)).not.toBeNull();
    expect(screen.getByText(/jam/)).not.toBeNull();
  });

  // The page used to say, verbatim, that it does not update itself and the
  // donor should reload it by hand after transferring -- at the exact moment
  // they most want certainty that their money arrived.
  test("promises to update itself, and does not ask for a manual reload", () => {
    const { container } = renderPage();
    expect(screen.getByText(/memeriksa statusnya sendiri/)).not.toBeNull();
    // The old copy read "muat ulang setelah transfer untuk melihat status
    // terbaru". The new copy says "tidak perlu dimuat ulang", so this asserts
    // the absence of the INSTRUCTION rather than of the word.
    expect(container.textContent).not.toMatch(/muat ulang setelah/);
  });

  test("polls the server while the donation is still pending", async () => {
    vi.useFakeTimers();
    renderPage();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(invalidateAll).toHaveBeenCalled();
  });

  test("does not poll once the donation has settled", async () => {
    vi.useFakeTimers();
    renderPage({ status: "paid", paidAt: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(30_000);
    // Polling a terminal donation is load with no answer at the end.
    expect(invalidateAll).not.toHaveBeenCalled();
  });

  test("offers the redirect for a pending QRIS donation", () => {
    renderPage({ method: "qris_redirect", vaNumber: null, redirectUrl: "https://pay.test/x" });
    const link = screen.getByText("Lanjutkan pembayaran");
    expect(link.getAttribute("href")).toBe("https://pay.test/x");
  });
});

describe("(consumer) donation/status/[id] — settled", () => {
  test("confirms receipt and says what happens to the money next", () => {
    renderPage({ status: "paid", paidAt: new Date().toISOString() });
    expect(screen.getByText(/Donasi diterima/)).not.toBeNull();
    // The moment after paying is when a donor is most receptive to the
    // mechanism, and this is the only page guaranteed to be seen.
    expect(
      screen.getByText(/tidak kami cairkan sebelum penggalang melampirkan bukti/),
    ).not.toBeNull();
    expect(screen.getByText("Lihat jejak dana kampanye ini").getAttribute("href")).toBe(
      "/campaign/kampanye-uji/pencairan-dana",
    );
  });

  test("gives the donor a reference they can quote back to us", () => {
    renderPage({ status: "paid", paidAt: new Date().toISOString() });
    expect(screen.getByText("11111111-2222-3333-4444-555555555555")).not.toBeNull();
  });

  // Neither of these states was designed for at all: an expired VA rendered
  // the pending screen forever, with a dead number and no way forward.
  test("an expired donation says so, states no money was taken, and offers a retry", () => {
    renderPage({ status: "expired" });
    expect(screen.getByText("Batas waktu pembayaran habis")).not.toBeNull();
    expect(screen.getByText(/Tidak ada dana yang terpotong/)).not.toBeNull();
    expect(screen.getByText("Coba lagi").getAttribute("href")).toBe("/campaign/kampanye-uji");
  });

  test("a failed donation says so too", () => {
    renderPage({ status: "failed" });
    expect(screen.getByText("Pembayaran tidak selesai")).not.toBeNull();
    expect(screen.getByText(/Tidak ada dana yang terpotong/)).not.toBeNull();
  });
});

describe("(consumer) donation/status/[id] — links out", () => {
  test("links to the campaign by slug, because /campaign/<uuid> 404s", () => {
    // Both links on this page used to interpolate campaignId. The route keys
    // on slug, so a donor who had just paid met two dead links at the exact
    // moment of most goodwill.
    renderPage({ status: "paid", paidAt: new Date().toISOString() });
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      expect(link.href).not.toMatch(/\/campaign\/c1(\/|$)/);
    }
  });

  test("offers the receipt once the donation has settled", () => {
    renderPage({ status: "paid", paidAt: new Date().toISOString() });
    const link = screen.getByRole("link", { name: "Lihat kuitansi" });
    expect(link.getAttribute("href")).toBe(
      "/donation/11111111-2222-3333-4444-555555555555/kuitansi",
    );
  });

  test("does not offer a receipt for a donation that has not settled", () => {
    // A kuitansi for unpaid money is a forgery the platform issued itself.
    renderPage({ status: "pending" });
    expect(screen.queryByText("Lihat kuitansi")).toBeNull();
  });
});
