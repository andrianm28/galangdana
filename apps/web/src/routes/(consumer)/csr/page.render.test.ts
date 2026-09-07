// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

describe("(consumer) /csr rendering", () => {
  test("states plainly that the full page is still being prepared, rather than faking the feature", () => {
    render(Page);
    expect(screen.getByText(/sedang kami siapkan/)).not.toBeNull();
  });

  test("routes an interested company to /contact", () => {
    render(Page);
    const link = screen.getByText("Hubungi kami soal kolaborasi CSR") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/contact");
  });
});
