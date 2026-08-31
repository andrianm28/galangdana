// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_CAMPAIGN = {
  id: "1",
  slug: "test-campaign",
  title: "Bantu Korban Banjir",
  shortDescription: "desc",
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

describe("(consumer) search rendering", () => {
  test("with no query, shows the search box and no results message", () => {
    render(Page, { props: { params: {}, data: { query: "", results: [] } } });
    expect(screen.getByPlaceholderText("Cari campaign...")).not.toBeNull();
    expect(screen.queryByText(/hasil untuk/)).toBeNull();
  });

  test("with a query and results, shows the result count and each campaign card", () => {
    render(Page, { props: { params: {}, data: { query: "banjir", results: [SAMPLE_CAMPAIGN] } } });
    expect(screen.getByText('1 hasil untuk "banjir"')).not.toBeNull();
    expect(screen.getByText("Bantu Korban Banjir")).not.toBeNull();
  });

  test("with a query and no results, shows a no-results message", () => {
    render(Page, { props: { params: {}, data: { query: "xyznomatch", results: [] } } });
    expect(screen.getByText('0 hasil untuk "xyznomatch"')).not.toBeNull();
    expect(screen.getByText(/Tidak ada campaign yang cocok/)).not.toBeNull();
  });

  test("the search input's value reflects the current query (so resubmitting doesn't clear it)", () => {
    render(Page, { props: { params: {}, data: { query: "banjir", results: [] } } });
    const input = screen.getByPlaceholderText("Cari campaign...") as HTMLInputElement;
    expect(input.value).toBe("banjir");
  });
});
