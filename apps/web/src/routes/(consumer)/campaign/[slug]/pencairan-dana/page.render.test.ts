// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) campaign/[slug]/pencairan-dana rendering", () => {
  test("shows an empty state when there are no paid disbursements", () => {
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { disbursements: [] }, form: null },
    });
    expect(screen.getByText("Belum ada pencairan dana untuk campaign ini.")).not.toBeNull();
  });

  test("shows paid disbursements with type, amount, date, and narrative", () => {
    render(Page, {
      props: {
        params: { slug: "test-campaign" },
        data: {
          disbursements: [
            {
              type: "partial",
              amount: { amount: "5000000", currency: "IDR" },
              narrative: "Biaya pengobatan tahap pertama",
              paidAt: "2026-01-15T00:00:00.000Z",
            },
            {
              type: "final",
              amount: { amount: "2500000", currency: "IDR" },
              narrative: "Pelunasan biaya perawatan",
              paidAt: "2026-02-20T00:00:00.000Z",
            },
          ],
        },
        form: null,
      },
    });

    expect(screen.getByText("Pencairan Sebagian - Rp5000000")).not.toBeNull();
    expect(screen.getByText("Biaya pengobatan tahap pertama")).not.toBeNull();
    expect(
      screen.getByText(new Date("2026-01-15T00:00:00.000Z").toLocaleDateString("id-ID")),
    ).not.toBeNull();

    expect(screen.getByText("Pencairan Akhir - Rp2500000")).not.toBeNull();
    expect(screen.getByText("Pelunasan biaya perawatan")).not.toBeNull();
  });
});
