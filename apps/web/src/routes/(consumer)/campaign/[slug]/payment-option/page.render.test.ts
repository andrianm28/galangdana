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
  test("shows the one available payment method", () => {
    render(Page);
    expect(screen.getByText(/Transfer Bank \(Virtual Account\)/)).not.toBeNull();
  });

  test("continuing goes to the contribute step with the amount preserved", async () => {
    const { goto } = await import("$app/navigation");
    render(Page);
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith("/campaign/test-campaign/contribute?amount=50000");
  });
});
