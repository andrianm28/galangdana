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
  currentStep: "ajakan",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("ajakan step rendering", () => {
  test("renders the heading and an empty input by default", () => {
    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    expect(screen.getByText("Ajakan untuk Donatur")).not.toBeNull();
  });

  test("pre-fills the input from an existing draft answer", () => {
    render(Page, {
      props: { data: { draft: { ...DRAFT, answers: { callToAction: "Mari bantu sesama" } } }, params: { draftId: DRAFT.id } },
    });
    expect(screen.getByLabelText("Kalimat ajakan singkat")).toHaveValue("Mari bantu sesama");
  });
});
