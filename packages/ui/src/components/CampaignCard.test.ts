import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import CampaignCard from "./CampaignCard.svelte";

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
  title: "Program Zakat Berkelanjutan",
  model: "program" as const,
  goalAmount: null,
  expiresAt: null,
  availableAmount: { amount: "200000000", currency: "IDR" as const },
};

describe("CampaignCard", () => {
  test("a goal-model campaign shows a progress bar and 'Terkumpul dari {target}'", () => {
    render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    expect(screen.getByText("Bantu Korban Banjir")).not.toBeNull();
    expect(screen.getByText(/Terkumpul dari/)).not.toBeNull();
    expect(screen.getByRole("progressbar")).not.toBeNull();
  });

  test("a program-model campaign shows 'Donasi tersedia' and no progress bar", () => {
    render(CampaignCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    expect(screen.getByText("Program Zakat Berkelanjutan")).not.toBeNull();
    expect(screen.getByText(/Donasi tersedia/)).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("renders the campaigner's display name and category title", () => {
    render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    expect(screen.getByText("Yayasan Test")).not.toBeNull();
    expect(screen.getByText("Bencana Alam")).not.toBeNull();
  });

  test("formats the collected amount using id-ID Rupiah grouping via @fundforindonesia/money", () => {
    render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    // formatMoney({amount: 45000000n, currency: "IDR"}) -> "Rp45.000.000" (id-ID grouping)
    expect(screen.getByText("Rp45.000.000")).not.toBeNull();
  });

  // src="" is not an absent image. Several browsers resolve an empty src
  // against the current document and re-request the page itself, and it never
  // fires onerror, so no fallback can hang off it. A campaign with no cover
  // must render no <img> at all.
  test("renders a labelled band instead of an empty <img> when there is no cover", () => {
    const { container } = render(CampaignCard, {
      props: { campaign: { ...GOAL_CAMPAIGN, coverImageUrl: null } },
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="cover-placeholder"]')).not.toBeNull();
  });

  test("still renders the cover image when one is present", () => {
    const { container } = render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.test/cover.jpg");
  });

  test("links to the campaign detail page via its slug", () => {
    const { container } = render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/campaign/test-goal-campaign");
  });

  test("a goal-model campaign shows the Ledger Line milestone ticks under the progress bar", () => {
    const { container } = render(CampaignCard, { props: { campaign: GOAL_CAMPAIGN } });
    expect(container.querySelectorAll('[data-testid="ledger-tick"]').length).toBe(3);
  });

  test("a program-model campaign shows no Ledger Line ticks (there is no goal to mark milestones against)", () => {
    const { container } = render(CampaignCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    expect(container.querySelectorAll('[data-testid="ledger-tick"]').length).toBe(0);
  });

  test("a program-model campaign's available amount renders in the mono register", () => {
    const { container } = render(CampaignCard, { props: { campaign: PROGRAM_CAMPAIGN } });
    const amount = screen.getByText("Rp200.000.000");
    expect(amount.className).toContain("font-mono");
    // Never the general UI font for this figure -- it's a stated fact, not a
    // headline, and the Record register is what marks that distinction.
    expect(container.querySelector('[data-testid="ledger-tick"]')).toBeNull();
  });
});
