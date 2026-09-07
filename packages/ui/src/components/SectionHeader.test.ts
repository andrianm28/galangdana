import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import SectionHeader from "./SectionHeader.svelte";

afterEach(() => cleanup());

describe("SectionHeader", () => {
  test("renders the title as an h2", () => {
    render(SectionHeader, { props: { title: "Kampanye Populer" } });
    expect(screen.getByRole("heading", { level: 2, name: "Kampanye Populer" })).not.toBeNull();
  });

  test("renders no link when href is not given", () => {
    render(SectionHeader, { props: { title: "Kampanye Populer" } });
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("renders a 'Lihat semua' link to href when given", () => {
    render(SectionHeader, { props: { title: "Kampanye Populer", href: "/explore" } });
    const link = screen.getByRole("link", { name: /Lihat semua/ });
    expect(link.getAttribute("href")).toBe("/explore");
  });

  test("uses a custom linkLabel when provided", () => {
    render(SectionHeader, {
      props: { title: "Kategori", href: "/category", linkLabel: "Semua kategori" },
    });
    const link = screen.getByRole("link", { name: /Semua kategori/ });
    expect(link.getAttribute("href")).toBe("/category");
    expect(screen.queryByText(/^Lihat semua/)).toBeNull();
  });
});
