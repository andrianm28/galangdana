// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

describe("campaigner cover page", () => {
  test("shows the uploader for an editable campaign", () => {
    render(Page, {
      props: {
        data: { campaignId: "c1", title: "Bantu Aldi", status: "active" },
        params: { id: "c1" },
        form: null,
      },
    });
    expect(screen.getByText("Foto Sampul")).not.toBeNull();
    expect(screen.getByText("Bantu Aldi")).not.toBeNull();
    expect(screen.getByText("Unggah")).not.toBeNull();
  });

  test("explains instead of offering upload while under review", () => {
    render(Page, {
      props: {
        data: { campaignId: "c1", title: "Bantu Aldi", status: "pending_review" },
        params: { id: "c1" },
        form: null,
      },
    });
    expect(
      screen.getByText("Sampul tidak dapat diubah selama campaign ditinjau atau ditolak."),
    ).not.toBeNull();
    expect(screen.queryByText("Unggah")).toBeNull();
  });
});
