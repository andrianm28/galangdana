// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "data-diri",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("data-diri step rendering", () => {
  test("renders the heading and an empty input by default", () => {
    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    expect(screen.getByText("Peran Anda")).not.toBeNull();
  });

  test("pre-fills the input from an existing draft answer", () => {
    render(Page, {
      props: { data: { draft: { ...DRAFT, answers: { campaignerRole: "Warga setempat" } } }, params: { draftId: DRAFT.id } },
    });
    expect(screen.getByLabelText("Apa peran Anda dalam penggalangan dana ini?")).toHaveValue(
      "Warga setempat",
    );
  });
});
