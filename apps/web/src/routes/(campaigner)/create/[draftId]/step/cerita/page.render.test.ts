// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { previousStep } from "../step-order";
import Page from "./+page.svelte";

// Required so importing the page (which imports $lib/api-client at module
// top-level) doesn't throw during render() -- see the identical mock in
// apps/web/src/routes/login/page.render.test.ts, the established pattern
// in this codebase for any page.svelte that imports $lib/api-client.
vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

// Spied so the "Kembali on an empty step" test can assert navigation
// happened WITHOUT going through a real SvelteKit router (goto() throws
// outside a real app context) and without hitting the network via
// $lib/api-client -- goto is the only externally-observable effect of
// save("back") skipping the (invalid, empty-content) API call.
const goto = vi.fn();
vi.mock("$app/navigation", () => ({
  goto: (...args: unknown[]) => goto(...args),
}));

// Widened past the plan's literal fixture: GET /campaign-drafts/:id's
// handler spreads the raw campaignDrafts row (which includes `userId`)
// into its response, and also always returns patient/beneficiary/
// documents alongside storyAnswers/manualStory -- so `data.draft`'s real
// inferred type (via Eden, from apps/api's already-merged Task 8 route)
// requires these fields even though packages/contracts's published
// CampaignDraftDetailSchema doesn't declare `userId`. Omitting them here
// fails `bun run typecheck` ("missing patient, beneficiary, documents,
// userId").
//
// Every render() call below also passes `params: { draftId: DRAFT.id }`
// -- this SvelteKit version's generated PageProps type is
// `{ params: RouteParams; data: PageData }`, so `props` must satisfy
// both even though the component itself only destructures `data`.
const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "cerita",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  patient: null,
  beneficiary: null,
  documents: [],
};

describe("cerita step rendering", () => {
  beforeEach(() => {
    goto.mockClear();
  });

  test("defaults to guided mode, showing 6 questions for a medical draft", () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: { draft: { ...DRAFT, storyAnswers: [], manualStory: null } },
      },
    });
    expect(screen.getByText("Sejak kapan kondisi ini dialami?")).not.toBeNull();
    expect(screen.getAllByRole("textbox").length).toBe(6);
  });

  test("shows 7 questions for a non_medical draft", () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: {
          draft: { ...DRAFT, track: "non_medical", storyAnswers: [], manualStory: null },
        },
      },
    });
    expect(screen.getAllByRole("textbox").length).toBe(7);
  });

  test("switching to manual mode shows one freeform textarea instead", async () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: { draft: { ...DRAFT, storyAnswers: [], manualStory: null } },
      },
    });
    const manualToggle = screen.getByText("Tulis manual");
    manualToggle.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByRole("textbox").length).toBe(1);
  });

  test("pre-fills manual mode when the draft already has a manual story and no guided answers", () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: {
          draft: { ...DRAFT, storyAnswers: [], manualStory: "Cerita yang sudah ditulis." },
        },
      },
    });
    // getByDisplayValue, not getByText: Svelte's bind:value sets the
    // textarea's `.value` DOM property directly rather than a child text
    // node, so getByText's textContent-based matcher can never see it --
    // getByDisplayValue is testing-library's query for exactly this case.
    expect(screen.getByDisplayValue("Cerita yang sudah ditulis.")).not.toBeNull();
  });

  test("clicking Kembali on a fresh, empty draft navigates back without an error, instead of forcing an invalid save", async () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: { draft: { ...DRAFT, storyAnswers: [], manualStory: null } },
      },
    });
    screen.getByText("Kembali").click();
    await new Promise((r) => setTimeout(r, 0));

    // No empty-content PUT was attempted (it would have failed
    // StoryQuestionAnswerSchema's minLength: 1 and surfaced this error).
    expect(screen.queryByText("Gagal menyimpan cerita. Silakan coba lagi.")).toBeNull();
    expect(goto).toHaveBeenCalledWith(
      `/create/${DRAFT.id}/step/${previousStep(DRAFT.track, "cerita")}`,
    );
  });
});
