// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_CATEGORIES = [
  { id: 1, slug: "bencana-alam", title: "Bencana Alam" },
  { id: 2, slug: "kesehatan", title: "Kesehatan" },
];

describe("(consumer) explore rendering", () => {
  test("renders one chip per category, with /explore/{slug} hrefs", () => {
    render(Page, {
      props: {
        params: {},
        data: { categories: SAMPLE_CATEGORIES },
      },
    });

    for (const category of SAMPLE_CATEGORIES) {
      const chip = screen.getByText(category.title) as HTMLAnchorElement;
      expect(chip.getAttribute("href")).toBe(`/explore/${category.slug}`);
    }
  });

  test("the empty state renders its sentence when categories is empty", () => {
    render(Page, {
      props: {
        params: {},
        data: { categories: [] },
      },
    });

    expect(screen.getByText(/Kategori tidak dapat dimuat saat ini/)).not.toBeNull();
  });
});
