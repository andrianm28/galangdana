// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

const CATEGORIES = [
  { id: 22, slug: "bencana-alam", title: "Bencana Alam" },
  { id: 8, slug: "balita-anak-sakit", title: "Balita & Anak Sakit" },
];

describe("select-category page rendering", () => {
  test("renders a track choice and the category list", () => {
    render(Page, { props: { data: { categories: CATEGORIES } } });
    expect(screen.getByText("Bencana Alam")).not.toBeNull();
    expect(screen.getByText("Balita & Anak Sakit")).not.toBeNull();
    expect(screen.getByLabelText("Medis")).not.toBeNull();
  });
});
