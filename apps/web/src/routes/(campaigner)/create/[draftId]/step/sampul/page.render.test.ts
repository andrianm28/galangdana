// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { type MockInstance, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { nextStep } from "../step-order";
import Page from "./+page.svelte";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

const goto = vi.fn();
vi.mock("$app/navigation", () => ({
  goto: (...args: unknown[]) => goto(...args),
}));

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "sampul",
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

describe("sampul step rendering", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    goto.mockClear();
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("unexpected network call in this test"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("renders the heading and the uploader", () => {
    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    expect(screen.getByText("Foto Sampul")).not.toBeNull();
    expect(screen.getByText("Unggah")).not.toBeNull();
  });

  test("blocks Lanjutkan without an upload: no navigation, no network", async () => {
    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    expect(screen.getByText("Unggah foto sampul terlebih dahulu.")).not.toBeNull();
    expect(goto).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("shows the saved state and proceeds when a cover key already exists", async () => {
    render(Page, {
      props: {
        data: { draft: { ...DRAFT, answers: { coverObjectKey: "drafts/x/cover/y.jpg" } } },
        params: { draftId: DRAFT.id },
      },
    });
    expect(screen.getByText("Sampul sudah diunggah.")).not.toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Lanjutkan" }));
    expect(goto).toHaveBeenCalledWith(
      `/create/${DRAFT.id}/step/${nextStep(DRAFT.track, "sampul")}`,
    );
  });
});
