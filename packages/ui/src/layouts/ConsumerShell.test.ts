import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import ConsumerShell from "./ConsumerShell.svelte";

afterEach(() => cleanup());

describe("ConsumerShell", () => {
  test("renders the FundForIndonesia wordmark and the page content", () => {
    const { container } = render(ConsumerShell, {
      props: { children: textSnippet("Homepage content") },
    });
    expect(screen.getByText("FundForIndonesia")).not.toBeNull();
    expect(screen.getByText("Homepage content")).not.toBeNull();
  });

  // This asserted `max-w-md` -- a ~416px column at every viewport, forever.
  // That was copied from Kitabisa, whose web is a deliberate mirror of its app;
  // this product has no app, so the constraint cost the whole desktop viewport
  // and bought nothing. The test is kept, inverted, so the cap cannot come back
  // by accident.
  test("uses a full desktop container, not a mobile-width column", () => {
    const { container } = render(ConsumerShell, { props: { children: textSnippet("x") } });
    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-[1200px]");
    expect(main?.className).not.toContain("max-w-md");
  });

  test("renders primary navigation, and every link points at a route that exists", () => {
    render(ConsumerShell, { props: { children: textSnippet("x") } });
    const nav = screen.getByRole("navigation", { name: "Navigasi utama" });
    expect(nav).not.toBeNull();
    // Kept in step with the routes under apps/web/src/routes/(consumer). The CI
    // link check crawls these for real and fails on a non-200, so this list
    // must not grow beyond pages that have actually been built.
    const expected = [
      ["Beranda", "/"],
      ["Cari", "/search"],
      ["Bantuan", "/help"],
      ["Kontak", "/contact"],
    ];
    for (const [label, href] of expected) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  test("credits Yayasan Indonesia Emas as the operating foundation, linking to its site", () => {
    render(ConsumerShell, { props: { children: textSnippet("x") } });
    const link = screen.getByRole("link", { name: "Yayasan Indonesia Emas" });
    expect(link.getAttribute("href")).toBe("https://yayasanindonesiaemas.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
