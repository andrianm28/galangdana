// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

function renderReceipt(overrides: Record<string, unknown> = {}) {
  return render(Page, {
    props: {
      params: { id: "11111111-2222-3333-4444-555555555555" },
      data: {
        donation: {
          id: "11111111-2222-3333-4444-555555555555",
          campaignId: "c1",
          campaignTitle: "Uluran Tangan untuk Aldi",
          campaignSlug: "uluran-tangan-untuk-aldi",
          amount: { amount: "250000", currency: "IDR" as const },
          status: "paid",
          method: "bank_transfer_va",
          vaNumber: "88012345678901",
          redirectUrl: null,
          expiresAt: "2026-09-07T00:00:00.000Z",
          paidAt: "2026-09-06T03:20:00.000Z",
          displayName: "Budi",
          ...overrides,
        },
      },
      form: null,
    },
  });
}

describe("(consumer) donation/[id]/kuitansi", () => {
  test("states the amount in figures and in Indonesian words", () => {
    renderReceipt();
    expect(screen.getByText("Rp250.000")).not.toBeNull();
    // The words are the anti-tampering device -- a figure alone is editable.
    expect(screen.getByText(/dua ratus lima puluh ribu rupiah/)).not.toBeNull();
  });

  test("names the campaign rather than printing its id", () => {
    renderReceipt();
    expect(screen.getByText("Uluran Tangan untuk Aldi")).not.toBeNull();
    expect(screen.queryByText("c1")).toBeNull();
  });

  test("names the donor they chose to be", () => {
    renderReceipt();
    expect(screen.getByText("Budi")).not.toBeNull();
  });

  test("says so in words when the donor left the name blank", () => {
    // A blank line where a name goes reads as a broken page, not a choice.
    renderReceipt({ displayName: null });
    expect(screen.getByText(/Sesama \(tanpa nama\)/)).not.toBeNull();
  });

  test("credits the operating foundation, so the receipt names a real entity", () => {
    renderReceipt();
    expect(screen.getByText(/Yayasan Indonesia Emas/)).not.toBeNull();
  });

  test("says plainly that receipt ≠ disbursement", () => {
    // The single most misleading thing a donation receipt can imply is that
    // the money already reached the beneficiary.
    renderReceipt();
    expect(screen.getByText(/bukan/)).not.toBeNull();
    expect(screen.getByText(/bukti bahwa dana sudah dicairkan/)).not.toBeNull();
  });

  test("links to the campaign's disbursement trail by slug, not by id", () => {
    // /campaign/<uuid>/pencairan-dana 404s -- the route keys on slug.
    renderReceipt();
    const link = screen.getByRole("link", { name: /jejak dananya/ });
    expect(link.getAttribute("href")).toBe("/campaign/uluran-tangan-untuk-aldi/pencairan-dana");
  });

  test("keeps itself out of search results", () => {
    // Donation ids are unguessable, but an indexed receipt is a receipt
    // anyone can find.
    renderReceipt();
    expect(document.head.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull();
  });

  test("offers a way back to the status page", () => {
    renderReceipt();
    const back = screen.getByRole("link", { name: /Kembali ke status donasi/ });
    expect(back.getAttribute("href")).toBe("/donation/status/11111111-2222-3333-4444-555555555555");
  });

  test("spells the payment method instead of leaking the enum", () => {
    renderReceipt();
    expect(screen.getByText(/Transfer bank \(Virtual Account\)/)).not.toBeNull();
    expect(screen.queryByText("bank_transfer_va")).toBeNull();
  });
});
