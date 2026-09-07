// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import type { PageData } from "./$types";
import Page from "./+page.svelte";

function renderHomepage(data: Partial<PageData> = {}) {
  return render(Page, {
    props: {
      params: {},
      data: { urgentCampaigns: [], latestCampaigns: [], categories: [], ...data },
    },
  });
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
  test("renders a campaign card for each campaign in the latest feed", () => {
    renderHomepage({ latestCampaigns: [SAMPLE_CAMPAIGN] });
    // Both the below-md CampaignListCard and the md+ CampaignCard grid render
    // in the DOM at once -- happy-dom applies no real CSS, so the `md:hidden`
    // / `hidden md:grid` split that picks one at a given viewport doesn't
    // hide either here. Two matches is the correct assertion, not one.
    expect(screen.getAllByText("Test Campaign")).toHaveLength(2);
    expect(screen.getAllByText("Test Campaigner")).toHaveLength(2);
  });

  test("shows an empty-state message when the latest feed is empty", () => {
    renderHomepage({ latestCampaigns: [] });
    expect(screen.getByText(/Belum ada campaign yang bisa ditampilkan/)).not.toBeNull();
  });
});

describe("(consumer) homepage category chip row", () => {
  test("renders a chip for each category, linking to its explore page", () => {
    renderHomepage({
      categories: [
        { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
        { id: 2, slug: "pendidikan", title: "Pendidikan" },
      ],
    });
    expect(screen.getByRole("link", { name: "Bencana Alam" }).getAttribute("href")).toBe(
      "/explore/bencana-alam",
    );
    expect(screen.getByRole("link", { name: "Pendidikan" }).getAttribute("href")).toBe(
      "/explore/pendidikan",
    );
  });

  test("renders no chips when there are no categories", () => {
    renderHomepage({ categories: [] });
    expect(screen.queryByRole("link", { name: "Bencana Alam" })).toBeNull();
  });
});

describe("(consumer) homepage urgent campaign carousel", () => {
  test("renders the section header and a campaign card for each urgent campaign", () => {
    renderHomepage({ urgentCampaigns: [SAMPLE_CAMPAIGN] });
    expect(screen.getByText("Penggalangan Dana Mendesak")).not.toBeNull();
    expect(screen.getByRole("group", { name: "Penggalangan Dana Mendesak" })).not.toBeNull();
    expect(screen.getByText("Test Campaign")).not.toBeNull();
  });

  test("shows an empty-state message when there are no urgent campaigns", () => {
    renderHomepage({ urgentCampaigns: [] });
    expect(screen.getByText(/Belum ada campaign mendesak/)).not.toBeNull();
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
