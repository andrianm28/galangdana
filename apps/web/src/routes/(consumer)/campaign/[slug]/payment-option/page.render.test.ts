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

type Method = "bank_transfer_va" | "qris_redirect";

function renderPage(methods: Method[] = ["bank_transfer_va", "qris_redirect"]) {
  return render(Page, {
    props: { data: { methods }, params: { slug: "test-campaign" }, form: null },
  });
}

describe("(consumer) campaign/[slug]/payment-option rendering", () => {
  test("shows both available payment methods", () => {
    renderPage();
    expect(screen.getByText(/Transfer Bank \(Virtual Account\)/)).not.toBeNull();
    expect(screen.getByText("QRIS")).not.toBeNull();
  });

  test("leaving the default selection and continuing goes to contribute with bank_transfer_va", async () => {
    const { goto } = await import("$app/navigation");
    renderPage();
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith(
      "/campaign/test-campaign/contribute?amount=50000&paymentMethod=bank_transfer_va",
    );
  });

  test("selecting QRIS and continuing goes to contribute with qris_redirect", async () => {
    const { goto } = await import("$app/navigation");
    renderPage();
    await fireEvent.click(screen.getByDisplayValue("qris_redirect"));
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith(
      "/campaign/test-campaign/contribute?amount=50000&paymentMethod=qris_redirect",
    );
  });

  test("selecting Bank Transfer explicitly and continuing goes to contribute with bank_transfer_va", async () => {
    const { goto } = await import("$app/navigation");
    renderPage();
    await fireEvent.click(screen.getByDisplayValue("qris_redirect"));
    await fireEvent.click(screen.getByDisplayValue("bank_transfer_va"));
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith(
      "/campaign/test-campaign/contribute?amount=50000&paymentMethod=bank_transfer_va",
    );
  });
});

describe("(consumer) campaign/[slug]/payment-option — only what works", () => {
  test("offers only the methods the server says it can fulfil", () => {
    // Production offered QRIS while its provider was unconfigured. Choosing it
    // returned 500 and the donor was told to try again -- advice that could
    // never work, because the cause was missing configuration.
    renderPage(["bank_transfer_va"]);
    expect(screen.getByText(/Transfer Bank \(Virtual Account\)/)).not.toBeNull();
    expect(screen.queryByText("QRIS")).toBeNull();
  });

  test("selects the first working method when the default is unavailable", async () => {
    const { goto } = await import("$app/navigation");
    renderPage(["qris_redirect"]);
    await fireEvent.click(screen.getByText("Lanjutkan"));
    expect(goto).toHaveBeenCalledWith(
      "/campaign/test-campaign/contribute?amount=50000&paymentMethod=qris_redirect",
    );
  });

  test("states the amount, formatted, so the donor can still check it here", () => {
    // This step used to show no amount at all -- the only screen in the funnel
    // that did not say what was being paid.
    renderPage();
    expect(screen.getByText("Rp50.000")).not.toBeNull();
  });
});
