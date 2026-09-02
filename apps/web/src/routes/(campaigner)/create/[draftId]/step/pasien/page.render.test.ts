// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
}));

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "pasien",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  storyAnswers: [],
  manualStory: null,
  patient: null,
  beneficiary: null,
  documents: [],
  userId: "test-user-id",
};

describe("pasien step rendering", () => {
  test("renders empty patient fields by default", () => {
    render(Page, {
      props: {
        data: { draft: { ...DRAFT, patient: null } },
        params: { draftId: DRAFT.id },
      },
    });
    expect((screen.getByLabelText("Nama pasien") as HTMLInputElement).value).toBe("");
  });

  test("pre-fills from an existing patient record", () => {
    render(Page, {
      props: {
        data: {
          draft: {
            ...DRAFT,
            patient: {
              name: "Aldi",
              age: 2,
              illness: "Kelainan jantung",
              hospitalName: null,
              relationshipToCampaigner: null,
            },
          },
        },
        params: { draftId: DRAFT.id },
      },
    });
    expect((screen.getByLabelText("Nama pasien") as HTMLInputElement).value).toBe("Aldi");
    expect((screen.getByLabelText("Kondisi/penyakit") as HTMLInputElement).value).toBe(
      "Kelainan jantung",
    );
  });

  test("back button does not require patient data", () => {
    render(Page, {
      props: {
        data: { draft: { ...DRAFT, patient: null } },
        params: { draftId: DRAFT.id },
      },
    });
    const backButton = screen.getByRole("button", { name: "Kembali" }) as HTMLButtonElement;
    expect(backButton.disabled).toBe(false);
    expect(screen.queryByText(/wajib diisi/)).toBe(null);
  });
});
