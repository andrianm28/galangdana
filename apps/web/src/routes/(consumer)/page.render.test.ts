// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import type { PageData } from "./$types";
import Page from "./+page.svelte";

function renderHomepage(data: Partial<PageData> = {}) {
  return render(Page, { props: { params: {}, data: { campaigns: [], ...data } } });
}

const SAMPLE_CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Test Campaign",
  shortDescription: "A test campaign",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 1, slug: "test", title: "Test Category" },
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
  status: "active" as const,
  publishedAt: new Date().toISOString(),
};

afterEach(() => cleanup());

describe("(consumer) homepage rendering", () => {
  test("renders a campaign card for each campaign in the feed", () => {
    renderHomepage({ campaigns: [SAMPLE_CAMPAIGN] });
    expect(screen.getByText("Test Campaign")).not.toBeNull();
    expect(screen.getByText("Test Campaigner")).not.toBeNull();
  });

  test("shows an empty-state message when the feed is empty", () => {
    renderHomepage({ campaigns: [] });
    expect(screen.getByText(/Belum ada campaign/)).not.toBeNull();
  });
});

describe("(consumer) homepage action grid", () => {
  const TILES: Array<{ label: string; href: string }> = [
    { label: "Donasi", href: "/explore" },
    { label: "Galang Dana", href: "/create/info" },
    { label: "Jejak Dana", href: "/jejak-dana" },
    { label: "Kolaborasi CSR", href: "/csr" },
  ];

  test("renders all four action tiles with the exact labels", () => {
    renderHomepage();
    for (const { label } of TILES) {
      expect(screen.getByRole("link", { name: label })).not.toBeNull();
    }
  });

  test("each action tile links to its exact href", () => {
    renderHomepage();
    for (const { label, href } of TILES) {
      expect(screen.getByRole("link", { name: label }).getAttribute("href")).toBe(href);
    }
  });
});
