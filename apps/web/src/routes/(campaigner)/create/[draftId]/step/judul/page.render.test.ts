// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { previousStep } from "../step-order";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

// Spied so the "Kembali on an empty step" test can assert navigation
// happened WITHOUT going through a real SvelteKit router (goto() throws
// outside a real app context) -- same pattern as cerita/page.render.test.ts's
// already-established fix for this exact class of bug.
const goto = vi.fn();
vi.mock("$app/navigation", () => ({
  goto: (...args: unknown[]) => goto(...args),
}));

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "judul",
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

describe("judul step rendering", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    goto.mockClear();
    // Rejects immediately rather than letting a real connection attempt
    // time out -- this test suite should never actually reach the network.
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("unexpected network call in this test"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("renders the heading and an empty input by default", () => {
    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    expect(screen.getByText("Judul Campaign")).not.toBeNull();
  });

  test("pre-fills the input from an existing draft answer", () => {
    render(Page, {
      props: {
        data: { draft: { ...DRAFT, answers: { title: "Bantu Operasi Anak" } } },
        params: { draftId: DRAFT.id },
      },
    });
    expect((screen.getByLabelText("Judul yang menarik dan jelas") as HTMLInputElement).value).toBe(
      "Bantu Operasi Anak",
    );
  });

  // Bug 3 regression test: save("back") used to call the answers PATCH
  // unconditionally, even with an empty value -- this endpoint's schema is
  // fully permissive, so that wouldn't 400, it would silently PERSIST an
  // empty string over a real saved value (combined with the layout
  // staleness bug). The fix skips the save entirely on "back" when empty.
  test("clicking Kembali on a fresh, empty step navigates back without attempting a save", async () => {
    render(Page, {
      props: { data: { draft: { ...DRAFT, answers: {} } }, params: { draftId: DRAFT.id } },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Kembali" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/wajib diisi/)).toBeNull();
    expect(goto).toHaveBeenCalledWith(
      `/create/${DRAFT.id}/step/${previousStep(DRAFT.track, "judul")}`,
    );
  });
});
