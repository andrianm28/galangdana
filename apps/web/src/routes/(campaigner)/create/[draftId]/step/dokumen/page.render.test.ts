// @vitest-environment happy-dom
import { render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Page from "./+page.svelte";

// api-client.ts reads $env/dynamic/public at import time, which SvelteKit's
// Vite plugin only populates for a real dev/build run -- not for a
// component render test. Mocked the same way src/routes/login's own
// page.render.test.ts already does, since this page is the only other one
// that imports api-client directly.
vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_API_URL: "http://localhost:3001",
  },
}));

// GET /campaign-drafts/:id's handler spreads the raw drizzle draft row
// (see apps/api/src/routes/campaign-drafts.ts) rather than only the
// declared CampaignDraftDetailSchema fields, so Eden's inferred PageData
// type also carries `userId` -- plus the always-present storyAnswers/
// manualStory/patient/beneficiary fields the brief's literal DRAFT object
// omitted. None of these are read by this page; they're here only to
// satisfy strict typecheck against that real inferred type.
const DRAFT = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  track: "medical" as const,
  categoryId: 22,
  currentStep: "dokumen",
  answers: {},
  storyAnswers: [],
  manualStory: null,
  patient: null,
  beneficiary: null,
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("dokumen step rendering", () => {
  test("shows the medical-track document type options", () => {
    render(Page, {
      props: { params: { draftId: DRAFT.id }, data: { draft: { ...DRAFT, documents: [] } } },
    });
    expect(screen.getByText("Riwayat medis")).not.toBeNull();
    expect(screen.queryByText("Kartu mahasiswa")).toBeNull();
  });

  test("lists already-uploaded documents", () => {
    render(Page, {
      props: {
        params: { draftId: DRAFT.id },
        data: {
          draft: {
            ...DRAFT,
            documents: [
              {
                id: "d1",
                type: "riwayat_medis",
                objectKey: "drafts/x/riwayat_medis/y.pdf",
                uploadedAt: new Date().toISOString(),
              },
            ],
          },
        },
      },
    });
    expect(screen.getByText("Riwayat medis", { exact: false })).not.toBeNull();
  });
});
