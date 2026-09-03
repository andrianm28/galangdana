// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_URL: "http://localhost:3001" } }));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({ goto: (...args: unknown[]) => goto(...args) }));

const REVISIONS = [
  {
    id: "r1",
    field: "cerita",
    note: "Cerita terlalu singkat, tambahkan detail.",
    status: "open",
    createdAt: "2026-09-02T00:00:00.000Z",
    resolvedAt: null,
  },
];

describe("campaigner revision-fix page", () => {
  test("shows each open revision request with the moderator's note", () => {
    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" }, form: null },
    });
    expect(screen.getByText("Cerita terlalu singkat, tambahkan detail.")).not.toBeNull();
  });

  test("saving a fixed story calls the story endpoint", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" }, form: null },
    });
    await fireEvent.input(screen.getByLabelText("Cerita baru"), {
      target: { value: "Cerita yang sudah lebih lengkap dan jelas." },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Simpan Cerita" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("clicking Ajukan Ulang resubmits and navigates to the dashboard", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "pending_review" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, {
      props: { data: { campaignId: "c1", revisions: REVISIONS }, params: { id: "c1" }, form: null },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Ajukan Ulang" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalled();
    expect(goto).toHaveBeenCalledWith("/dashboard");
    fetchSpy.mockRestore();
  });
});
