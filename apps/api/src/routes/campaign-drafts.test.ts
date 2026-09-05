import { beforeAll, describe, expect, test } from "bun:test";
import { campaignCategories, db, sessions, users } from "@fundforindonesia/db";
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

  test("404s (not 403) when saving a story to someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/story`, OTHER_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "manual", text: "hijack attempt" }),
      }),
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_not_found");
  });
});

describe("PUT /campaign-drafts/:id/patient", () => {
  test("upserts patient details, re-saving overwrites rather than duplicating", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const first = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/patient`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Aldi", age: 2, illness: "Kelainan jantung" }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/patient`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Aldi Revisi", age: 3, illness: "Kelainan jantung bawaan" }),
      }),
    );
    expect(second.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const body = (await detail.json()) as { patient: { name: string; age: number } | null };
    expect(body.patient?.name).toBe("Aldi Revisi");
    expect(body.patient?.age).toBe(3);
  });

  test("explicitly clearing an optional field with null actually clears it, not leaves it stale", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    // First save sets hospitalName.
    const first = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/patient`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Budi",
          illness: "Demam berdarah",
          hospitalName: "RS Persahabatan",
        }),
      }),
    );
    expect(first.status).toBe(200);

    const afterFirst = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const afterFirstBody = (await afterFirst.json()) as {
      patient: { hospitalName: string | null } | null;
    };
    expect(afterFirstBody.patient?.hospitalName).toBe("RS Persahabatan");

    // Second save sends hospitalName as an explicit null (this is what the
    // web client sends once it clears the field) -- the stale
    // "RS Persahabatan" value must not survive this.
    const second = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/patient`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Budi",
          illness: "Demam berdarah",
          hospitalName: null,
        }),
      }),
    );
    expect(second.status).toBe(200);

    const afterSecond = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const afterSecondBody = (await afterSecond.json()) as {
      patient: { hospitalName: string | null } | null;
    };
    expect(afterSecondBody.patient?.hospitalName).toBeNull();
  });

  test("404s (not 403) when saving patient details to someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/patient`, OTHER_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hijack", illness: "n/a" }),
      }),
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_not_found");
  });
});

describe("PUT /campaign-drafts/:id/beneficiary", () => {
  test("upserts beneficiary details", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "non_medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/beneficiary`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Warga Desa Sukamaju",
          needDescription: "Renovasi musala.",
        }),
      }),
    );
    expect(resp.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const body = (await detail.json()) as { beneficiary: { name: string } | null };
    expect(body.beneficiary?.name).toBe("Warga Desa Sukamaju");
  });

  test("404s (not 403) when saving beneficiary details to someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "non_medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/beneficiary`, OTHER_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hijack", needDescription: "n/a" }),
      }),
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_not_found");
  });
});

describe("POST /campaign-drafts/:id/documents/presign", () => {
  test("returns a presigned PUT URL scoped under drafts/{draftId}/{type}/", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(
        `http://localhost/campaign-drafts/${created.id}/documents/presign`,
        TEST_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "riwayat_medis", fileName: "riwayat.pdf" }),
        },
      ),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { uploadUrl: string; objectKey: string };
    expect(body.objectKey.startsWith(`drafts/${created.id}/riwayat_medis/`)).toBe(true);
    expect(body.objectKey.endsWith(".pdf")).toBe(true);
    expect(body.uploadUrl).toContain(body.objectKey);
  });

  test("rejects a disallowed file extension", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(
        `http://localhost/campaign-drafts/${created.id}/documents/presign`,
        TEST_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "riwayat_medis", fileName: "malware.exe" }),
        },
      ),
    );
    expect(resp.status).toBe(422);
  });

  test("404s (not 403) when presigning a document upload for someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(
        `http://localhost/campaign-drafts/${created.id}/documents/presign`,
        OTHER_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "riwayat_medis", fileName: "hijack.pdf" }),
        },
      ),
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_not_found");
  });
});

describe("POST /campaign-drafts/:id/documents (confirm)", () => {
  test("records the document after a real presigned upload round-trip", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const presignResp = await app.handle(
      authedRequest(
        `http://localhost/campaign-drafts/${created.id}/documents/presign`,
        TEST_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "riwayat_medis", fileName: "riwayat.pdf" }),
        },
      ),
    );
    const { uploadUrl, objectKey } = (await presignResp.json()) as {
      uploadUrl: string;
      objectKey: string;
    };

    // A real PUT against the real presigned URL, against real local MinIO
    // -- not a mock -- matching this codebase's established no-mocking
    // testing philosophy for real infrastructure.
    const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake pdf bytes" });
    expect(putResp.status).toBe(200);

    const confirmResp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/documents`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "riwayat_medis", objectKey }),
      }),
    );
    expect(confirmResp.status).toBe(200);

    const detail = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}`, TEST_TOKEN),
    );
    const detailBody = (await detail.json()) as {
      documents: Array<{ type: string; objectKey: string }>;
    };
    expect(detailBody.documents.length).toBe(1);
    expect(detailBody.documents[0]?.objectKey).toBe(objectKey);
  });

  test("rejects confirming an objectKey outside this draft's own prefix", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/documents`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "riwayat_medis",
          objectKey: "drafts/00000000-0000-0000-0000-000000000000/riwayat_medis/hijack.pdf",
        }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("404s (not 403) when confirming a document upload for someone else's draft", async () => {
    const createResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const created = (await createResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${created.id}/documents`, OTHER_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "riwayat_medis",
          objectKey: `drafts/${created.id}/riwayat_medis/hijack.pdf`,
        }),
      }),
    );
    // Ownership is checked before the objectKey-prefix check, so even a
    // well-formed, correctly-prefixed objectKey must still 404 (not 400 or
    // 200) for a non-owner -- this must never distinguish "exists but not
    // yours" from "doesn't exist".
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_not_found");
  });
});
