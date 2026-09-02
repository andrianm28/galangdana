// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

// Required because +page.svelte imports $lib/api-client at module scope,
// which imports $env/dynamic/public -- SvelteKit's virtual module for that
// isn't populated outside a real request context in vitest (matches the
// same fix already used in apps/web/src/routes/login/page.render.test.ts).
vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "otp",
  answers: {},
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  // Required to satisfy CampaignDraftDetailResponse (Task 7, already merged)
  // -- $types composes this page's data with the step layout's parent load,
  // whose `draft` is the GET /campaign-drafts/:id detail shape, not the bare
  // CampaignDraftSchema.
  storyAnswers: [],
  manualStory: null,
  patient: null,
  beneficiary: null,
  documents: [],
};

describe("otp step rendering", () => {
  test("shows the registered phone and a button to send the code", () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        form: undefined,
        data: { draft: DRAFT, phone: "+6281234567890" },
      },
    });
    expect(screen.getByText("+6281234567890", { exact: false })).not.toBeNull();
    expect(screen.getByText("Kirim kode OTP")).not.toBeNull();
  });
});
