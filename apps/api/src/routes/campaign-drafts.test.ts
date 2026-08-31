import { beforeAll, describe, expect, test } from "bun:test";
import { campaignCategories, db, sessions, users } from "@galangdana/db";
import { eq } from "drizzle-orm";
import { app } from "../index";

const TEST_USER_ID = "33333333-4444-5555-6666-777777777701";
const OTHER_USER_ID = "33333333-4444-5555-6666-777777777702";
const TEST_TOKEN = "campaign-drafts-test-token";
const OTHER_TOKEN = "campaign-drafts-other-token";
let categoryId: number;

beforeAll(async () => {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found — run db:seed first");
  categoryId = category.id;

  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.delete(users).where(eq(users.id, OTHER_USER_ID));
  await db.insert(users).values([
    { id: TEST_USER_ID, phone: "+6281199990201" },
    { id: OTHER_USER_ID, phone: "+6281199990202" },
  ]);
  await db.insert(sessions).values([
    { id: TEST_TOKEN, userId: TEST_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    { id: OTHER_TOKEN, userId: OTHER_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  ]);
});

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { ...init.headers, cookie: `session=${token}` },
  });
}

describe("POST /campaign-drafts", () => {
  test("requires authentication", async () => {
    const resp = await app.handle(
      new Request("http://localhost/campaign-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical" }),
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("creates a draft owned by the authenticated user, defaulting currentStep to 'info'", async () => {
    const resp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { id: string; track: string; currentStep: string };
    expect(body.track).toBe("medical");
    expect(body.currentStep).toBe("info");
    expect(body.id).toBeTruthy();
  });
});

describe("GET /campaign-drafts/:id", () => {
  test("returns the full draft detail for its owner", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "non_medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      id: string;
      storyAnswers: unknown[];
      documents: unknown[];
      patient: unknown;
      beneficiary: unknown;
    };
    expect(body.id).toBe(created.id);
    expect(body.storyAnswers).toEqual([]);
    expect(body.documents).toEqual([]);
    expect(body.patient).toBeNull();
    expect(body.beneficiary).toBeNull();
  });

  test("404s for a draft that does not exist", async () => {
    const resp = await app.handle(
      authedRequest(
        "http://localhost/campaign-drafts/00000000-0000-0000-0000-000000000000",
        TEST_TOKEN,
      ),
    );
    expect(resp.status).toBe(404);
  });

  test("404s (not 403) when a different user requests someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, OTHER_TOKEN),
    );
    // 404, not 403: this endpoint must not confirm to an unauthorized
    // caller that a draft with this ID even exists.
    expect(resp.status).toBe(404);
  });
});

describe("PATCH /campaign-drafts/:id/answers", () => {
  test("merges new answers into the existing jsonb and advances currentStep", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const first = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/answers`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "tujuan", answers: { purpose: "Biaya operasi jantung" } }),
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      currentStep: string;
      answers: Record<string, unknown>;
    };
    expect(firstBody.currentStep).toBe("tujuan");
    expect(firstBody.answers).toEqual({ purpose: "Biaya operasi jantung" });

    // A second save on a different step merges rather than replaces.
    const second = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/answers`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "judul", answers: { title: "Bantu Aldi Sembuh" } }),
      }),
    );
    const secondBody = (await second.json()) as {
      currentStep: string;
      answers: Record<string, unknown>;
    };
    expect(secondBody.currentStep).toBe("judul");
    expect(secondBody.answers).toEqual({
      purpose: "Biaya operasi jantung",
      title: "Bantu Aldi Sembuh",
    });
  });

  test("404s (not 403) when saving to someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/answers`, OTHER_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "tujuan", answers: { purpose: "hijack attempt" } }),
      }),
    );
    expect(resp.status).toBe(404);
  });
});

describe("PUT /campaign-drafts/:id/story", () => {
  test("guided mode replaces the full story-answer set", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const first = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "guided",
          answers: [
            { questionNumber: 1, answerText: "Jawaban pertama" },
            { questionNumber: 2, answerText: "Jawaban kedua" },
          ],
        }),
      }),
    );
    expect(first.status).toBe(200);

    const detailFirst = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailFirstBody = (await detailFirst.json()) as { storyAnswers: unknown[] };
    expect(detailFirstBody.storyAnswers.length).toBe(2);

    // Re-saving guided mode with fewer answers REPLACES the set, not merges.
    const second = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "guided",
          answers: [{ questionNumber: 1, answerText: "Jawaban revisi" }],
        }),
      }),
    );
    expect(second.status).toBe(200);

    const detailSecond = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailSecondBody = (await detailSecond.json()) as {
      storyAnswers: Array<{ questionNumber: number; answerText: string }>;
    };
    expect(detailSecondBody.storyAnswers.length).toBe(1);
    expect(detailSecondBody.storyAnswers[0]?.answerText).toBe("Jawaban revisi");
  });

  test("manual mode sets answers.story and clears any existing guided answers", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "non_medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "guided",
          answers: [{ questionNumber: 1, answerText: "will be cleared" }],
        }),
      }),
    );

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "manual", text: "Cerita lengkap yang ditulis manual." }),
      }),
    );
    expect(resp.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailBody = (await detail.json()) as {
      storyAnswers: unknown[];
      manualStory: string | null;
    };
    expect(detailBody.storyAnswers).toEqual([]);
    expect(detailBody.manualStory).toBe("Cerita lengkap yang ditulis manual.");
  });
});
