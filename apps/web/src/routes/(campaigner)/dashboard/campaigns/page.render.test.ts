// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

describe("campaigner dashboard rendering", () => {
  test("shows each campaign with a status badge", () => {
    render(Page, {
      props: {
        data: {
          campaigns: [
            {
              id: "1",
              slug: "bantu-aldi-sembuh",
              title: "Bantu Aldi Sembuh",
              status: "pending_review",
            },
            {
              id: "2",
              slug: "renovasi-masjid",
              title: "Renovasi Masjid",
              status: "needs_revision",
            },
          ],
        },
        params: {},
        form: null,
      },
    });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Renovasi Masjid")).not.toBeNull();
  });

  test("links a needs_revision campaign to its revision-fix page", () => {
    render(Page, {
      props: {
        data: {
          campaigns: [
            {
              id: "2",
              slug: "renovasi-masjid",
              title: "Renovasi Masjid",
              status: "needs_revision",
            },
          ],
        },
        params: {},
        form: null,
      },
    });
    const link = screen.getByRole("link", { name: /Perbaiki/ });
    expect(link.getAttribute("href")).toBe("/dashboard/campaigns/2/revise");
  });

  test("links an active campaign to the pencairan entry point", () => {
    render(Page, {
      props: {
        data: {
          campaigns: [
            {
              id: "3",
              slug: "bantu-warga-desa",
              title: "Bantu Warga Desa",
              status: "active",
            },
          ],
        },
        params: {},
        form: null,
      },
    });
    const link = screen.getByRole("link", { name: /Ajukan Pencairan/ });
    expect(link.getAttribute("href")).toBe("/dashboard/campaigns/3/pencairan");
  });

  test("shows an empty-state message with no campaigns yet", () => {
    render(Page, { props: { data: { campaigns: [] }, params: {}, form: null } });
    expect(screen.getByText(/belum punya campaign/i)).not.toBeNull();
  });
});
