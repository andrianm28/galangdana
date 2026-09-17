// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import type { PageData } from "./$types";
import Page from "./+page.svelte";

function renderHomepage(data: Partial<PageData> = {}) {
  return render(Page, {
    props: {
      params: {},
      data: {
        urgentCampaigns: [],
        latestCampaigns: [],
        programCampaigns: [],
        prayers: [],
        categories: [],
        ...data,
      },
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

  test("marks the urgent rail with a DARURAT badge", () => {
    renderHomepage({ urgentCampaigns: [SAMPLE_CAMPAIGN] });
    expect(screen.getByText("DARURAT")).not.toBeNull();
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

describe("(consumer) homepage ongoing programs", () => {
  test("renders the ongoing-programs rail when there are program campaigns", () => {
    const program = {
      ...SAMPLE_CAMPAIGN,
      slug: "program-1",
      title: "Program Berkelanjutan",
      model: "program" as const,
      goalAmount: null,
      expiresAt: null,
    };
    renderHomepage({ programCampaigns: [program] });
    expect(screen.getByText("Program Donasi Berkelanjutan")).not.toBeNull();
    expect(screen.getAllByText("Program Berkelanjutan").length).toBeGreaterThan(0);
  });

  test("omits the ongoing-programs section entirely when there are none", () => {
    renderHomepage({ programCampaigns: [] });
    // Omitted rather than shown with an empty state: an absent rail reads as
    // "this platform has no ongoing programmes", which is true, whereas an
    // empty box reads as something failing to load.
    expect(screen.queryByText("Program Donasi Berkelanjutan")).toBeNull();
  });
});

describe("(consumer) homepage prayer wall", () => {
  const PRAYER = {
    id: "p1",
    displayName: "Budi",
    message: "Semoga lekas sembuh",
    amiinCount: 2,
    createdAt: "2026-09-01T10:00:00.000Z",
    campaignSlug: "bantu-aldi",
    campaignTitle: "Bantu Aldi Sembuh",
  };

  test("renders the wall and links each prayer to its campaign", () => {
    renderHomepage({ prayers: [PRAYER] });
    expect(screen.getByText("Doa-doa #OrangBaik")).not.toBeNull();
    expect(screen.getByText("Semoga lekas sembuh")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Bantu Aldi Sembuh" }).getAttribute("href")).toBe(
      "/campaign/bantu-aldi",
    );
  });

  test("omits the section entirely when there are no prayers", () => {
    // An empty prayer wall on a homepage reads as a dead feature. On a campaign
    // page the empty state is right, because the invitation to write the first
    // one has somewhere to go.
    renderHomepage({ prayers: [] });
    expect(screen.queryByText("Doa-doa #OrangBaik")).toBeNull();
  });
});
