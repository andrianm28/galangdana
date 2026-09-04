// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const GOAL_CAMPAIGN = {
  id: "1",
  slug: "test-goal",
  title: "Test Goal Campaign",
  shortDescription: "desc",
  story: "Ini adalah cerita lengkap campaign.",
  coverImageUrl: "https://example.test/cover.jpg",
  category: { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
  campaigner: {
    id: "c1",
    type: "yayasan" as const,
    displayName: "Yayasan Test",
    avatarUrl: null,
    verified: true,
  },
  model: "goal" as const,
  goalAmount: { amount: "1000000", currency: "IDR" as const },
  collectedAmount: { amount: "500000", currency: "IDR" as const },
  availableAmount: { amount: "500000", currency: "IDR" as const },
  donationCount: 42,
  expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
  publishedAt: new Date().toISOString(),
};

const PROGRAM_CAMPAIGN = {
  ...GOAL_CAMPAIGN,
  slug: "test-program",
  title: "Test Program Campaign",
  model: "program" as const,
  goalAmount: null,
  expiresAt: null,
  availableAmount: { amount: "9000000", currency: "IDR" as const },
};

describe("(consumer) campaign/[slug] rendering", () => {
  test("a goal-model campaign shows the progress bar, days-left, and 'Terkumpul dari'", () => {
    render(Page, { props: { params: { slug: "test-goal" }, data: { campaign: GOAL_CAMPAIGN } } });
    expect(screen.getByText("Test Goal Campaign")).not.toBeNull();
    expect(screen.getByRole("progressbar")).not.toBeNull();
    expect(screen.getByText(/Terkumpul dari/)).not.toBeNull();
    expect(screen.getByText("5 hari lagi")).not.toBeNull();
  });

  test("a program-model campaign shows 'Donasi tersedia' with no progress bar and no days-left", () => {
    render(Page, {
      props: { params: { slug: "test-program" }, data: { campaign: PROGRAM_CAMPAIGN } },
    });
    expect(screen.getByText("Test Program Campaign")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Donasi tersedia")).not.toBeNull();
    expect(screen.queryByText(/hari lagi/)).toBeNull();
  });

  test("shows a verified badge for a verified campaigner", () => {
    render(Page, { props: { params: { slug: "test-goal" }, data: { campaign: GOAL_CAMPAIGN } } });
    expect(screen.getByText(/Terverifikasi/)).not.toBeNull();
  });

  test("renders the full story text", () => {
    render(Page, { props: { params: { slug: "test-goal" }, data: { campaign: GOAL_CAMPAIGN } } });
    expect(screen.getByText("Ini adalah cerita lengkap campaign.")).not.toBeNull();
  });

  test("links to the campaign's public disbursement log page", () => {
    render(Page, { props: { params: { slug: "test-goal" }, data: { campaign: GOAL_CAMPAIGN } } });
    const link = screen.getByText("Riwayat Pencairan Dana");
    expect(link.getAttribute("href")).toBe("/campaign/test-goal/pencairan-dana");
  });
});
