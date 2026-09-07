import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import MobileTabBar from "./MobileTabBar.svelte";

afterEach(() => cleanup());

describe("MobileTabBar", () => {
  test("renders five links with names distinct from ConsumerShell's desktop 'Beranda'/'Bantuan'", () => {
    render(MobileTabBar, { props: {} });
    expect(screen.getByRole("link", { name: "Beranda (navigasi bawah)" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Jelajah (navigasi bawah)" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Galang Dana (navigasi bawah)" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Jejak Dana (navigasi bawah)" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Bantuan (navigasi bawah)" })).not.toBeNull();
  });

  test("points each link at its route", () => {
    render(MobileTabBar, { props: {} });
    const cases: [string, string][] = [
      ["Beranda (navigasi bawah)", "/"],
      ["Jelajah (navigasi bawah)", "/explore"],
      ["Galang Dana (navigasi bawah)", "/create/info"],
      ["Jejak Dana (navigasi bawah)", "/jejak-dana"],
      ["Bantuan (navigasi bawah)", "/help"],
    ];
    for (const [name, href] of cases) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
  });

  test("marks only the link matching pathname with aria-current=page", () => {
    render(MobileTabBar, { props: { pathname: "/explore" } });
    expect(
      screen.getByRole("link", { name: "Jelajah (navigasi bawah)" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Beranda (navigasi bawah)" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  test("marks no link as active when pathname matches none of the five routes", () => {
    render(MobileTabBar, { props: { pathname: "/campaign/some-slug" } });
    for (const name of ["Beranda", "Jelajah", "Galang Dana", "Jejak Dana", "Bantuan"]) {
      expect(
        screen.getByRole("link", { name: `${name} (navigasi bawah)` }).getAttribute("aria-current"),
      ).toBeNull();
    }
  });

  test("is hidden at the md breakpoint and clears the iOS home indicator", () => {
    render(MobileTabBar, { props: {} });
    const nav = screen.getByRole("navigation", { name: "Navigasi bawah" });
    expect(nav.className).toContain("md:hidden");
    expect(nav.className).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});
