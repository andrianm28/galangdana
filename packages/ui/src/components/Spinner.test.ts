import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Spinner from "./Spinner.svelte";

afterEach(() => cleanup());

describe("Spinner", () => {
  test("renders with an accessible label and defaults to medium size", () => {
    const { getByRole } = render(Spinner, { props: {} });
    const spinner = getByRole("status");
    expect(spinner.className).toContain("size-6");
  });

  test("applies the small size class", () => {
    const { getByRole } = render(Spinner, { props: { size: "sm" } });
    const spinner = getByRole("status");
    expect(spinner.className).toContain("size-4");
  });
});
