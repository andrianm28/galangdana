// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, test } from "vitest";
import Page from "./+page.svelte";

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
  publishedAt: new Date().toISOString(),
};

afterEach(() => cleanup());

describe("(consumer) homepage rendering", () => {
  test("renders a campaign card for each campaign in the feed", () => {
    render(Page, { props: { params: {}, data: { campaigns: [SAMPLE_CAMPAIGN] } } });
    expect(screen.getByText("Test Campaign")).not.toBeNull();
    expect(screen.getByText("Test Campaigner")).not.toBeNull();
  });

  test("shows an empty-state message when the feed is empty", () => {
    render(Page, { props: { params: {}, data: { campaigns: [] } } });
    expect(screen.getByText(/Belum ada campaign/)).not.toBeNull();
  });
});
