// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: {
    url: new URL("http://localhost/campaign/test-campaign/payment-option?amount=50000"),
    params: { slug: "test-campaign" },
  },
}));

describe("(consumer) campaign/[slug]/payment-option rendering", () => {
  test("shows both available payment methods", () => {
    render(Page);
    expect(screen.getByText(/Transfer Bank \(Virtual Account\)/)).not.toBeNull();
    expect(screen.getByText("QRIS")).not.toBeNull();
  });

  test("leaving the default selection and continuing goes to contribute with bank_transfer_va", async () => {
    const { goto } = await import("$app/navigation");
    render(Page);
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith(
      "/campaign/test-campaign/contribute?amount=50000&paymentMethod=bank_transfer_va",
    );
  });

  test("selecting QRIS and continuing goes to contribute with qris_redirect", async () => {
    const { goto } = await import("$app/navigation");
    render(Page);
    await fireEvent.click(screen.getByDisplayValue("qris_redirect"));
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith(
      "/campaign/test-campaign/contribute?amount=50000&paymentMethod=qris_redirect",
    );
  });

  test("selecting Bank Transfer explicitly and continuing goes to contribute with bank_transfer_va", async () => {
    const { goto } = await import("$app/navigation");
    render(Page);
    await fireEvent.click(screen.getByDisplayValue("qris_redirect"));
    await fireEvent.click(screen.getByDisplayValue("bank_transfer_va"));
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith(
      "/campaign/test-campaign/contribute?amount=50000&paymentMethod=bank_transfer_va",
    );
  });
});
