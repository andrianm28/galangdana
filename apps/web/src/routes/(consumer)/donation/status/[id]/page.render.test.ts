// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) donation/status/[id] rendering", () => {
  test("shows the VA number and pending state", () => {
    render(Page, {
      props: {
        params: { id: "1" },
        data: {
          donation: {
            id: "1",
            campaignId: "c1",
            amount: { amount: "50000", currency: "IDR" },
            status: "pending",
            method: "bank_transfer_va",
            vaNumber: "88012345678901",
            redirectUrl: null,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            paidAt: null,
          },
        },
        form: null,
      },
    });
    expect(screen.getByText("88012345678901")).not.toBeNull();
    expect(screen.getByText(/Menunggu pembayaran/)).not.toBeNull();
  });

  test("shows a paid confirmation when status is paid", () => {
    render(Page, {
      props: {
        params: { id: "1" },
        data: {
          donation: {
            id: "1",
            campaignId: "c1",
            amount: { amount: "50000", currency: "IDR" },
            status: "paid",
            method: "bank_transfer_va",
            vaNumber: "88012345678901",
            redirectUrl: null,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            paidAt: new Date().toISOString(),
          },
        },
        form: null,
      },
    });
    expect(screen.getByText(/Donasi berhasil/)).not.toBeNull();
  });
});
