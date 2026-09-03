// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const SAMPLE_ARTICLES = [
  {
    id: "1",
    slug: "cara-berdonasi",
    question: "Bagaimana cara berdonasi?",
    answer: "Pilih campaign, tentukan nominal, lalu pilih metode pembayaran.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

describe("(consumer) /help rendering", () => {
  test("with no articles, shows an empty state", () => {
    render(Page, { props: { params: {}, data: { articles: [] } } });
    expect(screen.getByText(/Belum ada pertanyaan/)).not.toBeNull();
  });

  test("with articles, shows each question and answer", () => {
    render(Page, { props: { params: {}, data: { articles: SAMPLE_ARTICLES } } });
    expect(screen.getByText("Bagaimana cara berdonasi?")).not.toBeNull();
    expect(
      screen.getByText("Pilih campaign, tentukan nominal, lalu pilih metode pembayaran."),
    ).not.toBeNull();
  });
});
