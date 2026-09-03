// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const QUEUE = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "bantu-aldi-sembuh",
    title: "Bantu Aldi Sembuh",
    campaignerName: "Aldi Setiawan",
    categoryTitle: "Bantuan Medis",
    status: "pending_review",
    submittedAt: "2026-09-02T00:00:00.000Z",
  },
];

describe("admin dashboard rendering", () => {
  test("lists queued campaigns with campaigner and category names", () => {
    render(Page, { props: { data: { campaigns: QUEUE }, params: {}, form: null } });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Aldi Setiawan")).not.toBeNull();
    expect(screen.getByText("Bantuan Medis")).not.toBeNull();
  });

  test("shows an empty-queue message when there is nothing to review", () => {
    render(Page, { props: { data: { campaigns: [] }, params: {}, form: null } });
    expect(screen.getByText(/tidak ada campaign/i)).not.toBeNull();
  });

  test("links each row to its review detail page", () => {
    render(Page, { props: { data: { campaigns: QUEUE }, params: {}, form: null } });
    const link = screen.getByRole("link", { name: /Bantu Aldi Sembuh/ });
    expect(link.getAttribute("href")).toBe(`/campaigns/${QUEUE[0]?.id}`);
  });
});
