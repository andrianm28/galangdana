import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import CategoryChip from "./CategoryChip.svelte";

afterEach(() => cleanup());

function svgIconSnippet() {
  return ((anchor: Node) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-testid", "chip-icon");
    anchor.parentNode?.insertBefore(svg, anchor);
  }) as unknown as import("svelte").Snippet;
}

describe("CategoryChip", () => {
  test("renders a rounded-full pill link with the label as its accessible name", () => {
    render(CategoryChip, { props: { href: "/category/bencana-alam", label: "Bencana Alam" } });
    const link = screen.getByRole("link", { name: "Bencana Alam" });
    expect(link.getAttribute("href")).toBe("/category/bencana-alam");
    expect(link.className).toContain("rounded-full");
  });

  test("renders without an icon when none is given", () => {
    const { container } = render(CategoryChip, {
      props: { href: "/category/bencana-alam", label: "Bencana Alam" },
    });
    expect(container.querySelector('[data-testid="chip-icon"]')).toBeNull();
  });

  test("renders an inline SVG icon when given, without changing the accessible name", () => {
    const { container } = render(CategoryChip, {
      props: { href: "/category/bencana-alam", label: "Bencana Alam", icon: svgIconSnippet() },
    });
    expect(container.querySelector('[data-testid="chip-icon"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Bencana Alam" })).not.toBeNull();
  });
});
