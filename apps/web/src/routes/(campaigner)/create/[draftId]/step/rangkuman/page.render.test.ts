// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";
import Page from "./+page.svelte";

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  // The GET /campaign-drafts/:id handler spreads the raw DB row (which
  // includes userId) into its response, so Eden infers this field as
  // present on the SvelteKit PageData type even though it is absent from
  // both CampaignDraftDetailSchema and the real JSON response body -- an
  // upstream type/schema mismatch in apps/api (out of this task's scope)
  // that must be satisfied here for `bun run typecheck` to pass.
  userId: "22222222-2222-2222-2222-222222222222",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "rangkuman",
  answers: {
    title: "Bantu Aldi Sembuh",
    purpose: "Biaya operasi jantung",
    goalAmountStr: "15000000",
  },
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("rangkuman step rendering", () => {
  test("shows the collected title, purpose, and formatted goal amount", () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: {
          draft: {
            ...DRAFT,
            storyAnswers: [{ questionNumber: 1, answerText: "Sejak dua bulan lalu." }],
            manualStory: null,
            patient: {
              name: "Aldi",
              age: 2,
              illness: "Kelainan jantung",
              hospitalName: null,
              relationshipToCampaigner: null,
            },
            beneficiary: null,
            documents: [],
          },
        },
      },
    });
    expect(screen.getByText("Bantu Aldi Sembuh")).not.toBeNull();
    expect(screen.getByText("Biaya operasi jantung")).not.toBeNull();
    expect(screen.getByText("Rp15.000.000")).not.toBeNull();
    expect(screen.getByText("Aldi")).not.toBeNull();
    expect(screen.getByText("Sejak dua bulan lalu.")).not.toBeNull();
  });

  test("shows the manual story instead of guided answers when that mode was used", () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: {
          draft: {
            ...DRAFT,
            storyAnswers: [],
            manualStory: "Cerita lengkap yang ditulis manual.",
            patient: null,
            beneficiary: null,
            documents: [],
          },
        },
      },
    });
    expect(screen.getByText("Cerita lengkap yang ditulis manual.")).not.toBeNull();
  });
});
