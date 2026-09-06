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
  },
  {
    type: "final" as const,
    amount: { amount: "2500000", currency: "IDR" as const },
    narrative: "Pelunasan biaya perawatan",
    approvedAt: null,
    paidAt: "2026-02-20T00:00:00.000Z",
    proofState: "belum_ada" as const,
  },
];

describe("(consumer) campaign/[slug]/pencairan-dana rendering", () => {
  test("explains the gate rather than just saying the list is empty", () => {
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { disbursements: [] }, form: null },
    });
    expect(screen.getByText("Belum ada dana yang dicairkan.")).not.toBeNull();
    // The empty state is the first thing most visitors see on this page, so it
    // carries the mechanism. The two-person claim is true in code: /pay rejects
    // the approver, and approvedBy/paidBy record both.
    expect(screen.getByText(/dua\s+orang berbeda dari tim kami menyetujuinya/)).not.toBeNull();
  });

  // This page used to print `Rp{item.amount.amount}` -- literally "Rp5000000",
  // unformatted -- on the one surface whose entire job is to look like a
  // financial record. The old test asserted that string, pinning the bug.
  test("formats money with id-ID grouping, never a raw amount", () => {
    const { container } = render(Page, {
      props: { params: { slug: "test-campaign" }, data: { disbursements: PAID }, form: null },
    });
    expect(screen.getByText("Rp5.000.000")).not.toBeNull();
    expect(screen.getByText("Rp2.500.000")).not.toBeNull();
    expect(container.textContent).not.toContain("Rp5000000");
    expect(container.textContent).not.toContain("Rp2500000");
  });

  test("totals the disbursements", () => {
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { disbursements: PAID }, form: null },
    });
    expect(screen.getByText(/Total\s+Rp7\.500\.000/)).not.toBeNull();
    expect(screen.getByText("2 pencairan")).not.toBeNull();
  });

  test("states each row's proof state, including when no document is on file", () => {
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { disbursements: PAID }, form: null },
    });
    // A document exists -- the payout gate guarantees it -- but nothing can be
    // opened until uploads are redacted, so the label says exactly that rather
    // than claiming proof is published.
    expect(screen.getByText("Bukti ada, belum bisa dibuka")).not.toBeNull();
    // And a gap is stated plainly rather than hidden.
    expect(screen.getByText("Belum ada bukti")).not.toBeNull();
  });

  test("shows the approval date when there is one, and omits it when there is not", () => {
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { disbursements: PAID }, form: null },
    });
    expect(screen.getAllByText("Cair").length).toBe(2);
    // Only the first row has an approvedAt.
    expect(screen.getAllByText("Disetujui").length).toBe(1);
  });

  test("renders type and narrative for each row", () => {
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { disbursements: PAID }, form: null },
    });
    expect(screen.getByText("Pencairan sebagian")).not.toBeNull();
    expect(screen.getByText("Pencairan akhir")).not.toBeNull();
    expect(screen.getByText("Biaya pengobatan tahap pertama")).not.toBeNull();
    expect(screen.getByText("Pelunasan biaya perawatan")).not.toBeNull();
  });
});
