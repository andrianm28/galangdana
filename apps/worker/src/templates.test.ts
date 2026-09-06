import { describe, expect, test } from "bun:test";
import { renderDonationReceipt } from "./templates";

const DATA = {
  donationId: "00000000-0000-0000-0000-000000000001",
  amount: { amount: "50000", currency: "IDR" as const },
  campaignTitle: "Bantu Korban Banjir",
  displayName: null,
  paidAt: "2026-09-06T10:00:00.000Z",
  kuitansiUrl:
    "https://fundforindonesia.org/donation/00000000-0000-0000-0000-000000000001/kuitansi",
};

describe("renderDonationReceipt", () => {
  test("email subject names the receipt and the campaign", () => {
    const { subject } = renderDonationReceipt(DATA);
    expect(subject).toContain("Kuitansi");
    expect(subject).toContain("Bantu Korban Banjir");
  });

  test("html shows formatted amount, spelled-out amount, donor fallback, and kuitansi link", () => {
    const { html } = renderDonationReceipt({ ...DATA, displayName: "UAT Donatur" });
    expect(html).toContain("Rp50.000");
    expect(html).toContain("lima puluh ribu");
    expect(html).toContain("UAT Donatur");
    expect(html).toContain(DATA.kuitansiUrl);
  });

  test("null display name falls back to Sesama", () => {
    const { html } = renderDonationReceipt(DATA);
    expect(html).toContain("Sesama");
  });

  test("text version carries the same facts with no html tags", () => {
    const { text } = renderDonationReceipt(DATA);
    expect(text).toContain("Rp50.000");
    expect(text).toContain(DATA.kuitansiUrl);
    expect(text).not.toContain("<");
  });

  test("whatsapp version is short and carries amount, campaign, and link", () => {
    const { whatsapp } = renderDonationReceipt(DATA);
    expect(whatsapp.length).toBeLessThan(500);
    expect(whatsapp).toContain("Rp50.000");
    expect(whatsapp).toContain("Bantu Korban Banjir");
    expect(whatsapp).toContain(DATA.kuitansiUrl);
  });
});
