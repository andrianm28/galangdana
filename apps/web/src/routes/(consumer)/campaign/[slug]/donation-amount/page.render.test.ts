// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

const CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Test Campaign",
  goalAmount: { amount: "10000000", currency: "IDR" },
  collectedAmount: { amount: "2000000", currency: "IDR" },
};

describe("(consumer) campaign/[slug]/donation-amount rendering", () => {
  test("shows the campaign title and an amount input", () => {
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { campaign: CAMPAIGN }, form: null },
    });
    expect(screen.getByText("Test Campaign")).not.toBeNull();
    expect(screen.getByLabelText("Nominal donasi")).not.toBeNull();
  });

  test("navigating with an amount goes to the payment-option step", async () => {
    const { goto } = await import("$app/navigation");
    render(Page, {
      props: { params: { slug: "test-campaign" }, data: { campaign: CAMPAIGN }, form: null },
    });
    await fireEvent.input(screen.getByLabelText("Nominal donasi"), { target: { value: "50000" } });
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith("/campaign/test-campaign/payment-option?amount=50000");
  });
});
