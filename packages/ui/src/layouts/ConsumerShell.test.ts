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
    // must not grow beyond pages that have actually been built. "Galang Dana"
    // is included now that /create/info exists -- MobileTabBar's link to it
    // uses a distinct accessible name ("Galang Dana (navigasi bawah)"), so
    // this bare query still resolves to exactly one element.
    const expected = [
      ["Beranda", "/"],
      ["Cari", "/search"],
      ["Galang Dana", "/create/info"],
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

  // Below md the header's link list is replaced by a search affordance -- an
  // honest <a>, not a non-functional <input>, since this shell has no
  // client-side search.
  test("renders a search affordance linking to /search", () => {
    render(ConsumerShell, { props: { children: textSnippet("x") } });
    const link = screen.getByRole("link", { name: "Cari campaign" });
    expect(link.getAttribute("href")).toBe("/search");
  });

  // MobileTabBar is mounted inside the shell and given the current pathname
  // so it can mark the active tab. Its links carry aria-labels distinct from
  // the desktop nav's (see MobileTabBar.svelte), which is what keeps every
  // getByRole("link", { name }) query above resolving to a single element
  // even though happy-dom renders both nav sets regardless of md:hidden.
  test("renders the bottom tab bar with the active tab marked from pathname", () => {
    render(ConsumerShell, { props: { children: textSnippet("x"), pathname: "/explore" } });
    const tabBar = screen.getByRole("navigation", { name: "Navigasi bawah" });
    expect(tabBar).not.toBeNull();
    const active = screen.getByRole("link", { name: "Jelajah (navigasi bawah)" });
    expect(active.getAttribute("aria-current")).toBe("page");
    const inactive = screen.getByRole("link", { name: "Beranda (navigasi bawah)" });
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
