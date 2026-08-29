// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Test Campaign",
  shortDescription: "A test campaign",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
  campaigner: {
    id: "c1",
    type: "individual" as const,
    displayName: "Test Campaigner",
    avatarUrl: null,
    verified: false,
  },
  model: "goal" as const,
  goalAmount: { amount: "1000000", currency: "IDR" as const },
  collectedAmount: { amount: "500000", currency: "IDR" as const },
  availableAmount: { amount: "500000", currency: "IDR" as const },
  donationCount: 10,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

describe("(consumer) explore/[category] rendering", () => {
  test("renders the category name, count, and each campaign card", () => {
    render(Page, {
      props: {
        params: { category: "bencana-alam" },
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: null,
          campaigns: [SAMPLE_CAMPAIGN],
          totalCount: 1,
        },
      },
    });
    expect(screen.getByText("bencana alam")).not.toBeNull();
    expect(screen.getByText("1 campaign ditemukan")).not.toBeNull();
    expect(screen.getByText("Test Campaign")).not.toBeNull();
  });

  test("highlights the active sort option", () => {
    render(Page, {
      props: {
        params: { category: "bencana-alam" },
        data: {
          category: "bencana-alam",
          sort: "urgent",
          campaignerType: null,
          campaigns: [],
          totalCount: 0,
        },
      },
    });
    const urgentLink = screen.getByText("Paling Mendesak");
    expect(urgentLink.className).toContain("text-primary");
  });

  test("highlights 'Semua' by default and the matching type label when a type filter is active", () => {
    const { unmount } = render(Page, {
      props: {
        params: { category: "bencana-alam" },
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: null,
          campaigns: [],
          totalCount: 0,
        },
      },
    });
    expect(screen.getByText("Semua").className).toContain("text-primary");
    unmount();

    render(Page, {
      props: {
        params: { category: "bencana-alam" },
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: "yayasan",
          campaigns: [],
          totalCount: 0,
        },
      },
    });
    expect(screen.getByText("Yayasan").className).toContain("text-primary");
    expect(screen.getByText("Semua").className).not.toContain("text-primary");
  });

  test("a sort link preserves the active type filter in its href", () => {
    render(Page, {
      props: {
        params: { category: "bencana-alam" },
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: "platform",
          campaigns: [],
          totalCount: 0,
        },
      },
    });
    const urgentLink = screen.getByText("Paling Mendesak") as HTMLAnchorElement;
    expect(urgentLink.getAttribute("href")).toBe("?sort=urgent&type=platform");
  });

  test("shows an empty-state message when no campaigns match", () => {
    render(Page, {
      props: {
        params: { category: "bencana-alam" },
        data: {
          category: "bencana-alam",
          sort: "newest",
          campaignerType: null,
          campaigns: [],
          totalCount: 0,
        },
      },
    });
    expect(screen.getByText(/Belum ada campaign di kategori ini/)).not.toBeNull();
  });
});
