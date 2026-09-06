// @vitest-environment happy-dom
vi.mock("$app/state", () => ({ page: { status: 404, error: null } }));

import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import ErrorPage from "./ErrorPage.svelte";
import PageTitle from "./PageTitle.svelte";

describe("PageTitle", () => {
  test("sets the document title", () => {
    // Nine of twelve consumer pages shipped with no <title> at all and there
    // is no layout fallback, so their browser tabs read as raw URLs.
    render(PageTitle, { props: { title: "Status donasi" } });
    expect(document.title).toBe("Status donasi");
  });

  test("keeps the page out of search results", () => {
    render(PageTitle, { props: { title: "Konfirmasi donasi" } });
    expect(document.head.querySelector('meta[name="robots"][content="noindex"]')).not.toBeNull();
  });

  test("emits no share card for a page meant for one person", () => {
    // A checkout step or a payment status means nothing to anyone but its
    // owner; a share card for one is worse than none.
    render(PageTitle, { props: { title: "Pilih nominal donasi" } });
    expect(document.head.querySelector('meta[property^="og:"]')).toBeNull();
    expect(document.head.querySelector('meta[name^="twitter:"]')).toBeNull();
  });
});

describe("ErrorPage", () => {
  test("offers a way out instead of stranding the visitor", () => {
    // SvelteKit's default renders the status and message as bare text with no
    // shell, no navigation, and no link anywhere on the page.
    render(ErrorPage);
    for (const [name, href] of [
      [/Kembali ke beranda/, "/"],
      [/Cari kampanye/, "/search"],
      [/Hubungi kami/, "/contact"],
    ] as const) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
  });

  test("explains a 404 in words a person would use", () => {
    render(ErrorPage);
    expect(screen.getByText(/Halaman ini tidak ada/)).not.toBeNull();
    expect(screen.getByText(/salah ketik, atau kampanyenya sudah ditutup/)).not.toBeNull();
  });
});
