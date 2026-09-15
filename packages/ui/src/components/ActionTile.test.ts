import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import ActionTile from "./ActionTile.svelte";

afterEach(() => cleanup());

// icon must be a Snippet rendering inline SVG, not a glyph string -- this
// stands in for a real icon like Alert.test.ts's textSnippet stands in for
// real message content.
function svgIconSnippet() {
  return ((anchor: Node) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-testid", "tile-icon");
    anchor.parentNode?.insertBefore(svg, anchor);
  }) as unknown as import("svelte").Snippet;
}

describe("ActionTile", () => {
  test("renders as a link to href with the label as its accessible name", () => {
    render(ActionTile, {
      props: { href: "/create/info", label: "Galang Dana", icon: svgIconSnippet() },
    });
    const link = screen.getByRole("link", { name: "Galang Dana" });
    expect(link.getAttribute("href")).toBe("/create/info");
  });

  test("renders the icon as inline SVG inside an aria-hidden wrapper (the label carries the meaning)", () => {
    const { container } = render(ActionTile, {
      props: { href: "/create/info", label: "Galang Dana", icon: svgIconSnippet() },
    });
    const svg = container.querySelector('[data-testid="tile-icon"]');
    expect(svg).not.toBeNull();
    expect(svg?.tagName.toLowerCase()).toBe("svg");
    expect(svg?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  // The holder is white-on-ring, NOT bg-primary-light as it originally was.
  // The tile icons are two-tone -- a primary-light fill inside a primary
  // outline -- so on a primary-light holder the icon's own fill vanished into
  // the background and only the outline read. This asserts the new intent
  // rather than just dropping the old assertion: the holder must stay a circle,
  // and must NOT reintroduce the tint that swallowed the icons.
  test("gives the icon holder a circular white treatment, not the primary tint", () => {
    const { container } = render(ActionTile, {
      props: { href: "/create/info", label: "Galang Dana", icon: svgIconSnippet() },
    });
    const holder = container.querySelector('[aria-hidden="true"]');
    expect(holder?.className).toContain("rounded-full");
    expect(holder?.className).toContain("bg-white");
    expect(holder?.className).not.toContain("bg-primary-light");
  });
});
