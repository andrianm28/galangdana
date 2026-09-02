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
  id: "22222222-2222-2222-2222-222222222222",
  track: "non_medical" as const,
  categoryId: 23,
  currentStep: "penerima",
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

describe("penerima step rendering", () => {
  test("renders empty beneficiary fields by default", () => {
    render(Page, {
      props: {
        data: { draft: { ...DRAFT, beneficiary: null } },
        params: { draftId: DRAFT.id },
      },
    });
    expect((screen.getByLabelText("Nama penerima manfaat") as HTMLInputElement).value).toBe("");
  });

  test("pre-fills from an existing beneficiary record", () => {
    render(Page, {
      props: {
        data: {
          draft: {
            ...DRAFT,
            beneficiary: {
              name: "Warga Desa Sukamaju",
              relationship: null,
              needDescription: "Renovasi musala",
            },
          },
        },
        params: { draftId: DRAFT.id },
      },
    });
    expect((screen.getByLabelText("Nama penerima manfaat") as HTMLInputElement).value).toBe(
      "Warga Desa Sukamaju",
    );
  });

  test("back button does not require beneficiary data", () => {
    render(Page, {
      props: {
        data: { draft: { ...DRAFT, beneficiary: null } },
        params: { draftId: DRAFT.id },
      },
    });
    const backButton = screen.getByRole("button", { name: "Kembali" }) as HTMLButtonElement;
    expect(backButton.disabled).toBe(false);
    expect(screen.queryByText(/wajib diisi/)).toBe(null);
  });
});
