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

function renderPage() {
  return render(Page, {
    props: { params: { slug: "test-campaign" }, data: { campaign: CAMPAIGN }, form: null },
  });
}

const AMOUNT_LABEL = "Atau masukkan nominal lain";

describe("(consumer) campaign/[slug]/donation-amount rendering", () => {
  test("shows the campaign title and an amount input", () => {
    renderPage();
    expect(screen.getByText("Test Campaign")).not.toBeNull();
    expect(screen.getByLabelText(AMOUNT_LABEL)).not.toBeNull();
  });

  test("navigating with an amount goes to the payment-option step", async () => {
    const { goto } = await import("$app/navigation");
    renderPage();
    await fireEvent.input(screen.getByLabelText(AMOUNT_LABEL), { target: { value: "50000" } });
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith("/campaign/test-campaign/payment-option?amount=50000");
  });

  // Free-text entry at peak intent is the single largest conversion leak in
  // this funnel: it summons a numeric keyboard and asks the donor to compose a
  // number at the exact moment they have already decided to give.
  test("offers one-tap presets, none preselected", () => {
    renderPage();
    for (const label of ["Rp25.000", "Rp50.000", "Rp100.000", "Rp250.000"]) {
      const button = screen.getByText(label);
      expect(button).not.toBeNull();
      // A pre-filled amount is a nudge this product does not get to make.
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    expect((screen.getByLabelText(AMOUNT_LABEL) as HTMLInputElement).value).toBe("");
  });

  test("tapping a preset fills the amount and marks it pressed", async () => {
    const { goto } = await import("$app/navigation");
    vi.mocked(goto).mockClear();
    renderPage();
    await fireEvent.click(screen.getByText("Rp100.000"));
    expect(screen.getByText("Rp100.000").getAttribute("aria-pressed")).toBe("true");
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith("/campaign/test-campaign/payment-option?amount=100000");
  });

  // There was no floor at all: the contract's ^\d+$ accepted "1", so a Rp 1
  // donation was creatable -- it costs more in provider fees than it delivers,
  // and a stream of them is what card-testing traffic looks like.
  test("refuses an amount below the minimum, and says what the minimum is", async () => {
    const { goto } = await import("$app/navigation");
    vi.mocked(goto).mockClear();
    renderPage();
    await fireEvent.input(screen.getByLabelText(AMOUNT_LABEL), { target: { value: "1" } });
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Rp10.000");
  });

  test("refuses an amount above the ceiling, which is a typo guard", async () => {
    const { goto } = await import("$app/navigation");
    vi.mocked(goto).mockClear();
    renderPage();
    await fireEvent.input(screen.getByLabelText(AMOUNT_LABEL), {
      target: { value: "5000000000" },
    });
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).not.toBeNull();
  });

  test("rejects non-numeric input with a message about the format", async () => {
    const { goto } = await import("$app/navigation");
    vi.mocked(goto).mockClear();
    renderPage();
    await fireEvent.input(screen.getByLabelText(AMOUNT_LABEL), { target: { value: "50.000" } });
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("tanpa titik");
  });
});
