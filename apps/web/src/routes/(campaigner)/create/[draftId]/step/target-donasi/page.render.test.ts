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

// Spied so tests can assert navigation happened WITHOUT going through a real
// SvelteKit router (goto() throws outside a real app context) -- same
// pattern as apps/web/src/routes/(campaigner)/create/[draftId]/step/cerita/
// page.render.test.ts's already-established fix for this exact class of bug.
const goto = vi.fn();
vi.mock("$app/navigation", () => ({
  goto: (...args: unknown[]) => goto(...args),
}));

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "target-donasi",
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

describe("target-donasi step rendering", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    goto.mockClear();
    // Reject by default: most tests below should never actually reach the
    // network (either because the "back"-while-empty path skips the save
    // entirely, or because a synchronous crash would happen before fetch is
    // ever called). Rejecting immediately, instead of letting a real
    // connection attempt time out, also keeps the suite fast and avoids
    // relying on network egress being available in the test sandbox.
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValue(new Error("unexpected network call in this test"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test("renders the heading and an empty input by default", () => {
    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    expect(screen.getByText("Target Donasi")).not.toBeNull();
  });

  test("pre-fills the input from an existing draft answer", () => {
    render(Page, {
      props: {
        data: { draft: { ...DRAFT, answers: { goalAmountStr: "50000000" } } },
        params: { draftId: DRAFT.id },
      },
    });
    expect((screen.getByLabelText("Jumlah target (Rp)") as HTMLInputElement).value).toBe(
      "50000000",
    );
  });

  // Regression test for the input-crashes-on-real-typing bug: bind:value on
  // a type="number" input coerces the bound variable through Svelte's
  // to_number() helper (string -> number/null) the moment a user types,
  // which then breaks save()'s `value.trim()` call. The fix uses one-way
  // value={value} + an oninput handler that reads e.currentTarget.value
  // (always a string on a real DOM element, regardless of input type) so
  // `value` never stops being a string.
  test("typing a numeric value into the input keeps it usable, without throwing", async () => {
    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    const input = screen.getByLabelText("Jumlah target (Rp)") as HTMLInputElement;

    await fireEvent.input(input, { target: { value: "1500000" } });

    expect(input.value).toBe("1500000");
    expect(screen.queryByText(/wajib diisi/)).toBeNull();
  });

  // Goes further than the above: proves save("next") itself survives a real
  // typed value all the way through -- with the pre-fix bind:value bug,
  // `value` becomes a number after typing, `value.trim` doesn't exist, and
  // save("next") throws synchronously (converted into a silently rejected
  // promise since save() is async and its caller never awaits or catches
  // it) -- submitting stays true forever, goto is never called, and the
  // user is stuck on a dead "Lanjutkan" button. If that regressed, this
  // test's final assertion would never see `goto` called and would fail.
  test("clicking Lanjutkan after typing a numeric value saves and navigates without crashing", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(Page, { props: { data: { draft: DRAFT }, params: { draftId: DRAFT.id } } });
    const input = screen.getByLabelText("Jumlah target (Rp)") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "1500000" } });

    const nextButton = screen.getByRole("button", { name: "Lanjutkan" });
    await fireEvent.click(nextButton);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/wajib diisi/)).toBeNull();
    expect(screen.queryByText("Gagal menyimpan. Silakan coba lagi.")).toBeNull();
    expect(goto).toHaveBeenCalledWith(`/create/${DRAFT.id}/step/cerita`);
  });

  // Bug 3 regression test: save("back") used to call the answers PATCH
  // unconditionally, even with an empty value -- since this endpoint's
  // schema is fully permissive (Type.Record(Type.String(), Type.Unknown())),
  // that wouldn't 400, it would silently PERSIST an empty string over a real
  // saved value once combined with the layout staleness bug. The fix skips
  // the save entirely on "back" when the field is empty.
  test("clicking Kembali on a fresh, empty step navigates back without attempting a save", async () => {
    render(Page, {
      props: { data: { draft: { ...DRAFT, answers: {} } }, params: { draftId: DRAFT.id } },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Kembali" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/wajib diisi/)).toBeNull();
    expect(goto).toHaveBeenCalledWith(
      `/create/${DRAFT.id}/step/${previousStep(DRAFT.track, "target-donasi")}`,
    );
  });
});
