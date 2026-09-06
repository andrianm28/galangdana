// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { fireEvent } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

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

const CANONICAL = "https://fundforindonesia.org/campaign/test-goal";

describe("(consumer) campaign/[slug] rendering", () => {
  test("a goal-model campaign shows the progress bar, days-left, and 'Terkumpul dari'", () => {
    render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: GOAL_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    expect(screen.getByText("Test Goal Campaign")).not.toBeNull();
    expect(screen.getByRole("progressbar")).not.toBeNull();
    expect(screen.getByText(/Terkumpul dari/)).not.toBeNull();
    expect(screen.getByText("5 hari lagi")).not.toBeNull();
  });

  test("a program-model campaign shows 'Donasi tersedia' with no progress bar and no days-left", () => {
    render(Page, {
      props: {
        params: { slug: "test-program" },
        data: { campaign: PROGRAM_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    expect(screen.getByText("Test Program Campaign")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Donasi tersedia")).not.toBeNull();
    expect(screen.queryByText(/hari lagi/)).toBeNull();
  });

  test("shows a verified badge for a verified campaigner", () => {
    render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: GOAL_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    expect(screen.getByText(/Terverifikasi/)).not.toBeNull();
  });

  test("renders the full story text", () => {
    render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: GOAL_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    expect(screen.getByText("Ini adalah cerita lengkap campaign.")).not.toBeNull();
  });

  test("gives the disbursement log a real entry point that states the mechanism", () => {
    const { container } = render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: GOAL_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    const link = container.querySelector('a[href="/campaign/test-goal/pencairan-dana"]');
    expect(link).not.toBeNull();
    expect(screen.getByText("Lihat jejak dana")).not.toBeNull();
    expect(screen.getByText(/Dana tidak kami cairkan sebelum\s+buktinya ada/)).not.toBeNull();
  });

  test("the donate button navigates to this campaign's donation-amount step", async () => {
    const { goto } = await import("$app/navigation");
    render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: GOAL_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    await fireEvent.click(screen.getByText("Donasi Sekarang"));
    expect(goto).toHaveBeenCalledWith("/campaign/test-goal/donation-amount");
  });
});

describe("(consumer) campaign/[slug] link preview metadata", () => {
  // A forwarded link is the most-viewed surface in this funnel and it did not
  // exist: app.html had no og: tags, so WhatsApp rendered a grey URL chip.
  // These assertions read document.head because <svelte:head> renders there.
  test("emits absolute og:url and og:image, and a large-image twitter card", () => {
    render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: GOAL_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    const head = document.head;
    expect(head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(CANONICAL);
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(CANONICAL);

    const image = head.querySelector('meta[property="og:image"]')?.getAttribute("content");
    expect(image).toBe(GOAL_CAMPAIGN.coverImageUrl);
    // Relative URLs are resolved by the scraper, not the browser, so a
    // non-absolute og:image silently drops the card.
    expect(image?.startsWith("http")).toBe(true);

    expect(head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe(
      "summary_large_image",
    );
    expect(head.querySelector('meta[property="og:locale"]')?.getAttribute("content")).toBe("id_ID");
  });

  test("the description carries the money position, not just the title again", () => {
    render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: GOAL_CAMPAIGN, canonicalUrl: CANONICAL },
      },
    });
    const description = document.head
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");
    // What a forwarded card has to answer is "how far along is this".
    expect(description).toContain("terkumpul dari");
    expect(description).toContain("Rp");
  });

  test("falls back to a summary card when the campaign has no cover", () => {
    render(Page, {
      props: {
        params: { slug: "test-goal" },
        data: { campaign: { ...GOAL_CAMPAIGN, coverImageUrl: null }, canonicalUrl: CANONICAL },
      },
    });
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
    expect(document.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe(
      "summary",
    );
  });
});
