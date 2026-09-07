import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import LedgerTicks from "./LedgerTicks.svelte";

afterEach(() => cleanup());

describe("LedgerTicks", () => {
  test("renders exactly three milestone ticks", () => {
    const { container } = render(LedgerTicks);
    expect(container.querySelectorAll('[data-testid="ledger-tick"]').length).toBe(3);
  });

  test("is decorative, not announced to assistive tech", () => {
    // The bar it sits under already carries role="progressbar" with its own
    // aria-valuenow; these ticks add no new information a screen reader
    // needs read aloud.
    const { container } = render(LedgerTicks);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
