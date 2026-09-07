// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const PAID = [
  {
    type: "partial" as const,
    amount: { amount: "5000000", currency: "IDR" as const },
    narrative: "Biaya pengobatan tahap pertama",
    approvedAt: "2026-01-14T00:00:00.000Z",
    paidAt: "2026-01-15T00:00:00.000Z",
    proofState: "ada_tertutup" as const,
    campaignSlug: "bantu-aldi-sembuh",
    campaignTitle: "Bantu Aldi Sembuh",
  },
  {
    type: "final" as const,
    amount: { amount: "2500000", currency: "IDR" as const },
    narrative: "Pelunasan biaya perawatan",
    approvedAt: null,
    paidAt: "2026-02-20T00:00:00.000Z",
    proofState: "belum_ada" as const,
    campaignSlug: "sumur-bor-masjid",
    campaignTitle: "Sumur Bor untuk Masjid",
  },
];

describe("(consumer) /jejak-dana rendering", () => {
  test("explains the two-person, proof-gated mechanism regardless of state", () => {
    render(Page, { props: { params: {}, data: { disbursements: [] } } });
    expect(screen.getByText(/dua orang berbeda dari tim kami harus menyetujuinya/)).not.toBeNull();
  });

  // The empty state is the primary state today (disbursement_requests has no
  // paid rows in production yet), so it must read as a confident explanation
  // of the mechanism, not as a broken or missing page.
  test("empty state explains the gate rather than looking broken", () => {
    render(Page, { props: { params: {}, data: { disbursements: [] } } });
    expect(screen.getByText("Belum ada dana yang dicairkan di platform ini.")).not.toBeNull();
  });

  test("renders each feed row with its campaign, amount, and a link to that campaign's own ledger", () => {
    render(Page, { props: { params: {}, data: { disbursements: PAID } } });

    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Sumur Bor untuk Masjid")).not.toBeNull();
    expect(screen.getByText("Rp5.000.000")).not.toBeNull();
    expect(screen.getByText("Rp2.500.000")).not.toBeNull();

    const links = screen.getAllByRole("link") as HTMLAnchorElement[];
    expect(
      links.some((a) => a.getAttribute("href") === "/campaign/bantu-aldi-sembuh/pencairan-dana"),
    ).toBe(true);
    expect(
      links.some((a) => a.getAttribute("href") === "/campaign/sumur-bor-masjid/pencairan-dana"),
    ).toBe(true);
  });

  test("states each row's proof state, including when no document is on file", () => {
    render(Page, { props: { params: {}, data: { disbursements: PAID } } });
    expect(screen.getByText("Bukti ada, belum bisa dibuka")).not.toBeNull();
    expect(screen.getByText("Belum ada bukti")).not.toBeNull();
  });
});
