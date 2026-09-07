import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import CampaignListCard from "./CampaignListCard.svelte";

afterEach(() => cleanup());

const GOAL_CAMPAIGN = {
  slug: "test-goal-campaign",
  title: "Bantu Korban Banjir",
  shortDescription: "Ratusan keluarga membutuhkan bantuan",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 22, slug: "bencana-alam", title: "Bencana Alam" },
  campaigner: {
    id: "c1",
    type: "yayasan" as const,
    displayName: "Yayasan Test",
    avatarUrl: null,
    verified: true,
  },
  model: "goal" as const,
  goalAmount: { amount: "100000000", currency: "IDR" as const },
  collectedAmount: { amount: "45000000", currency: "IDR" as const },
  availableAmount: { amount: "45000000", currency: "IDR" as const },
  donationCount: 120,
  expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

const PROGRAM_CAMPAIGN = {
  ...GOAL_CAMPAIGN,
  slug: "test-program-campaign",
  title: "Program Air Bersih Berkelanjutan",
  model: "program" as const,
  goalAmount: null,
  expiresAt: null,
  availableAmount: { amount: "200000000", currency: "IDR" as const },
};

describe("CampaignListCard", () => {
  test("a goal-model campaign shows a progress bar, collected amount, and days remaining", () => {
    render(CampaignListCard, { props: { campaign: GOAL_CAMPAIGN } });
    expect(screen.getByText("Bantu Korban Banjir")).not.toBeNull();
    expect(screen.getByRole("progressbar")).not.toBeNull();
    expect(screen.getByText(/Terkumpul/)).not.toBeNull();
    expect(screen.getByText(/Sisa hari 10/)).not.toBeNull();
  });

  // Program campaigns have goalAmount: null and expiresAt: null -- an
  // unbranched version would render a bogus 0% bar and "Sisa hari NaN".
  test("a program-model campaign shows no progress bar and no 'Sisa hari' line", () => {
    render(CampaignListCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    expect(screen.getByText("Program Air Bersih Berkelanjutan")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Sisa hari/)).toBeNull();
    expect(screen.getByText(/Donasi tersedia/)).not.toBeNull();
  });

  test("renders a size-24 thumbnail", () => {
    const { container } = render(CampaignListCard, { props: { campaign: GOAL_CAMPAIGN } });
    const img = container.querySelector("img");
    expect(img?.className).toContain("size-24");
  });

  test("renders a labelled band instead of an empty <img> when there is no cover", () => {
    const { container } = render(CampaignListCard, {
      props: { campaign: { ...GOAL_CAMPAIGN, coverImageUrl: null } },
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="cover-placeholder"]')).not.toBeNull();
  });

  test("links to the campaign detail page via its slug", () => {
    const { container } = render(CampaignListCard, { props: { campaign: GOAL_CAMPAIGN } });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/campaign/test-goal-campaign");
  });

  test("a program-model campaign's available amount renders in the mono register", () => {
    render(CampaignListCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    const amount = screen.getByText("Rp200.000.000");
    expect(amount.className).toContain("font-mono");
  });
});
