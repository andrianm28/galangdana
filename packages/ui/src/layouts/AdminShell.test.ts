import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import AdminShell from "./AdminShell.svelte";

afterEach(() => cleanup());

describe("AdminShell", () => {
  test("renders a sidebar with the FundForIndonesia wordmark, a title, and the page content", () => {
    render(AdminShell, { props: { title: "Dashboard", children: textSnippet("Panel content") } });
    expect(screen.getByText("FundForIndonesia")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Dashboard" })).not.toBeNull();
    expect(screen.getByText("Panel content")).not.toBeNull();
  });

  test("does not constrain content width the way ConsumerShell does", () => {
    const { container } = render(AdminShell, { props: { children: textSnippet("x") } });
    const main = container.querySelector("main");
    expect(main?.className).not.toContain("max-w-md");
  });

  test("renders navigation to every route (admin)/ actually has an index page for", () => {
    render(AdminShell, { props: { pathname: "/dashboard", children: textSnippet("x") } });
    // Deliberately excludes /campaigns/[id]: there is no /campaigns index
    // page, only campaign detail reached from the Dashboard's own queue --
    // a nav entry for it would 404 on click.
    const expected = [
      ["Dashboard", "/dashboard"],
      ["Pencairan", "/disbursements"],
      ["Artikel Bantuan", "/help-articles"],
      ["Tiket Dukungan", "/support-tickets"],
    ];
    for (const [label, href] of expected) {
      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  test("marks the current route's nav item active, and no other", () => {
    render(AdminShell, { props: { pathname: "/disbursements", children: textSnippet("x") } });
    expect(screen.getByRole("link", { name: "Pencairan" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
  });

  test("derives the header title from the route when no explicit title is given", () => {
    render(AdminShell, { props: { pathname: "/help-articles", children: textSnippet("x") } });
    expect(screen.getByRole("heading", { name: "Artikel Bantuan" })).not.toBeNull();
  });

  test("an explicit title prop still wins over the route-derived one", () => {
    render(AdminShell, {
      props: { title: "Tinjau Kampanye", pathname: "/dashboard", children: textSnippet("x") },
    });
    expect(screen.getByRole("heading", { name: "Tinjau Kampanye" })).not.toBeNull();
  });

  test("with no pathname given, no nav item is marked active and no title is derived", () => {
    render(AdminShell, { props: { children: textSnippet("x") } });
    for (const label of ["Dashboard", "Pencairan", "Artikel Bantuan", "Tiket Dukungan"]) {
      expect(screen.getByRole("link", { name: label }).getAttribute("aria-current")).toBeNull();
    }
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

function textSnippet(text: string) {
  return ((anchor: Node) => {
    anchor.parentNode?.insertBefore(document.createTextNode(text), anchor);
  }) as unknown as import("svelte").Snippet;
}
