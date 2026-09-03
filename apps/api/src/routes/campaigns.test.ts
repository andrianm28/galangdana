import { beforeAll, describe, expect, test } from "bun:test";
import {
  campaignCategories,
  campaignDocuments,
  campaignRevisions,
  campaigners,
  campaigns,
  db,
  individualVerifications,
  sessions,
  users,
} from "@galangdana/db";
import { eq, inArray } from "drizzle-orm";
import { app } from "../index";

const TEST_USER_ID = "44444444-5555-6666-7777-888888888801";
const OTHER_USER_ID = "44444444-5555-6666-7777-888888888802";
const TEST_TOKEN = "campaigns-test-token";
const OTHER_TOKEN = "campaigns-other-token";
let categoryId: number;

beforeAll(async () => {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category found — run db:seed first");
  categoryId = category.id;

  // A prior run of this file's own "creates a real campaign" test leaves a
  // real `campaigns` row behind, whose `campaignerId` FK has no cascade.
  // Deleting the test users below cascades to their `campaigners` row
  // (campaigners.userId IS cascade), which then fails with a FK violation
  // unless that leftover campaign is cleared first.
  const staleCampaigners = await db
    .select({ id: campaigners.id })
    .from(campaigners)
    .where(inArray(campaigners.userId, [TEST_USER_ID, OTHER_USER_ID]));
  if (staleCampaigners.length > 0) {
    await db.delete(campaigns).where(
      inArray(
        campaigns.campaignerId,
        staleCampaigners.map((c) => c.id),
      ),
    );
  }

  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.delete(users).where(eq(users.id, OTHER_USER_ID));
  await db.insert(users).values([
    { id: TEST_USER_ID, phone: "+6281199990301" },
    { id: OTHER_USER_ID, phone: "+6281199990302" },
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

async function fillKycIdentityAndContact(campaignId: string, token: string) {
  await app.handle(
    authedRequest(`http://localhost/campaigns/${campaignId}/kyc/identity`, token, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fullName: "Aldi Setiawan",
        nationalId: "3271234567890001",
        dateOfBirth: "1990-05-12",
      }),
    }),
  );
  await app.handle(
    authedRequest(`http://localhost/campaigns/${campaignId}/kyc/contact`, token, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "Jl. Merdeka No. 1",
        city: "Bandung",
        postalCode: "40111",
      }),
    }),
  );
}

async function uploadKycDocuments(campaignId: string, token: string) {
  for (const documentType of ["ktp", "selfie"] as const) {
    const presignResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaignId}/kyc/documents/presign`, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType, fileName: `${documentType}.jpg` }),
      }),
    );
    const { uploadUrl, objectKey } = (await presignResp.json()) as {
      uploadUrl: string;
      objectKey: string;
    };
    await fetch(uploadUrl, { method: "PUT", body: "fake image bytes" });
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaignId}/kyc/documents/confirm`, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType, objectKey }),
      }),
    );
  }
}

async function createTestCampaign(token: string) {
  const createDraftResp = await app.handle(
    authedRequest("http://localhost/campaign-drafts", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track: "medical", categoryId }),
    }),
  );
  const draft = (await createDraftResp.json()) as { id: string };

  await app.handle(
    authedRequest(`http://localhost/campaign-drafts/${draft.id}/answers`, token, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        step: "rangkuman",
        answers: {
          title: "Bantu Aldi Sembuh",
          purpose: "Biaya operasi jantung",
          goalAmountStr: "15000000",
        },
      }),
    }),
  );
  await app.handle(
    authedRequest(`http://localhost/campaign-drafts/${draft.id}/story`, token, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "manual", text: "Cerita lengkap Aldi." }),
    }),
  );

  const resp = await app.handle(
    authedRequest("http://localhost/campaigns", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.id }),
    }),
  );
  expect(resp.status).toBe(200);
  const body = (await resp.json()) as { id: string; slug: string };
  return { id: body.id, slug: body.slug, draftId: draft.id };
}

describe("GET /campaigns", () => {
  test("returns a paginated list of active campaigns with money fields as MoneyJSON", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      campaigns: Array<{ collectedAmount: { amount: string; currency: string }; model: string }>;
      page: number;
      totalPages: number;
      totalCount: number;
    };
    expect(body.campaigns.length).toBeGreaterThan(0);
    expect(body.totalCount).toBeGreaterThanOrEqual(8); // this plan's own seed data
    expect(typeof body.campaigns[0]?.collectedAmount.amount).toBe("string");
  });

  test("filters by category slug", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?category=zakat"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { campaigns: Array<{ category: { slug: string } }> };
    expect(body.campaigns.length).toBeGreaterThan(0);
    for (const c of body.campaigns) {
      expect(c.category.slug).toBe("zakat");
    }
  });

  test("sort=newest orders by publishedAt descending", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?sort=newest&limit=50"));
    const body = (await resp.json()) as { campaigns: Array<{ publishedAt: string }> };
    const dates = body.campaigns.map((c) => new Date(c.publishedAt).getTime());
    const sorted = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sorted);
  });

  test("sort=urgent orders goal-model campaigns by soonest deadline first, program campaigns last", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?sort=urgent&limit=50"));
    const body = (await resp.json()) as {
      campaigns: Array<{ model: string; expiresAt: string | null }>;
    };
    const goalCampaigns = body.campaigns.filter((c) => c.model === "goal");
    const deadlines = goalCampaigns.map((c) => new Date(c.expiresAt as string).getTime());
    const sorted = [...deadlines].sort((a, b) => a - b);
    expect(deadlines).toEqual(sorted);

    const lastGoalIndex = body.campaigns.map((c) => c.model).lastIndexOf("goal");
    const firstProgramIndex = body.campaigns.map((c) => c.model).indexOf("program");
    if (firstProgramIndex !== -1) {
      expect(lastGoalIndex).toBeLessThan(firstProgramIndex);
    }
  });

  test("cover image URLs are real, fully-formed imgproxy URLs, not raw object keys", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?limit=1"));
    const body = (await resp.json()) as { campaigns: Array<{ coverImageUrl: string }> };
    expect(body.campaigns[0]?.coverImageUrl).toMatch(/^http:\/\/localhost:8090\//);
    expect(body.campaigns[0]?.coverImageUrl).not.toContain("campaigns/covers/");
  });

  test("pagination: limit and page narrow the result set", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns?limit=2&page=1"));
    const body = (await resp.json()) as { campaigns: unknown[]; page: number };
    expect(body.campaigns.length).toBe(2);
    expect(body.page).toBe(1);
  });
});

describe("GET /campaigns/:slug", () => {
  test("returns full campaign detail including story, for a known seeded slug", async () => {
    const resp = await app.handle(
      new Request("http://localhost/campaigns/bantu-korban-banjir-bandang-kalimantan-selatan"),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { title: string; story: string; model: string };
    expect(body.title).toContain("Banjir Bandang");
    expect(body.story.length).toBeGreaterThan(0);
    expect(body.model).toBe("goal");
  });

  test("a program-model campaign has a null goalAmount/expiresAt and a nonzero availableAmount", async () => {
    const resp = await app.handle(
      new Request("http://localhost/campaigns/program-amil-zakat-mitra"),
    );
    const body = (await resp.json()) as {
      model: string;
      goalAmount: unknown;
      expiresAt: unknown;
      availableAmount: { amount: string };
    };
    expect(body.model).toBe("program");
    expect(body.goalAmount).toBeNull();
    expect(body.expiresAt).toBeNull();
    expect(BigInt(body.availableAmount.amount)).toBeGreaterThan(0n);
  });

  test("returns 404 for an unknown slug", async () => {
    const resp = await app.handle(new Request("http://localhost/campaigns/does-not-exist"));
    expect(resp.status).toBe(404);
  });
});

describe("POST /campaigns", () => {
  test("creates a real campaign from a finished draft, in status 'draft'", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("draft");
    expect(row?.title).toBe("Bantu Aldi Sembuh");
    expect(row?.goalAmount).toBe(15000000n);
    expect(row?.story).toBe("Cerita lengkap Aldi.");
    expect(row?.draftId).toBe(campaign.draftId);
    expect(campaign.slug).toContain("bantu-aldi-sembuh");
  });

  test("requires authentication", async () => {
    const resp = await app.handle(
      new Request("http://localhost/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: "11111111-1111-1111-1111-111111111111" }),
      }),
    );
    expect(resp.status).toBe(401);
  });

  test("404s (not 403) when creating from someone else's draft", async () => {
    const createDraftResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const draft = (await createDraftResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest("http://localhost/campaigns", OTHER_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      }),
    );
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_not_found");
  });

  test("400s when the draft is missing required fields", async () => {
    const createDraftResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const draft = (await createDraftResp.json()) as { id: string };

    const resp = await app.handle(
      authedRequest("http://localhost/campaigns", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("400s (not 500) when goalAmountStr is not a valid integer literal", async () => {
    const createDraftResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const draft = (await createDraftResp.json()) as { id: string };

    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${draft.id}/answers`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: "rangkuman",
          answers: {
            title: "Bantu Aldi Sembuh",
            purpose: "Biaya operasi jantung",
            goalAmountStr: "abc",
          },
        }),
      }),
    );
    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${draft.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "manual", text: "Cerita lengkap Aldi." }),
      }),
    );

    const resp = await app.handle(
      authedRequest("http://localhost/campaigns", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      }),
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("draft_incomplete");
  });
});

describe("PUT /campaigns/:id/kyc/identity", () => {
  test("saves identity fields for the owning user's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Aldi Setiawan",
          nationalId: "3271234567890001",
          dateOfBirth: "1990-05-12",
        }),
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(row?.fullName).toBe("Aldi Setiawan");
  });

  test("re-saving overwrites rather than duplicating (upsert on unique campaignId)", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "First Name",
          nationalId: "1111111111111111",
          dateOfBirth: "1990-01-01",
        }),
      }),
    );
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Revised Name",
          nationalId: "2222222222222222",
          dateOfBirth: "1991-02-02",
        }),
      }),
    );

    const rows = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.fullName).toBe("Revised Name");
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, OTHER_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "x",
          nationalId: "1111111111111111",
          dateOfBirth: "1990-01-01",
        }),
      }),
    );
    expect(resp.status).toBe(404);
  });

  test("409s once the campaign has left draft/needs_revision (e.g. after a successful submit)", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await fillKycIdentityAndContact(campaign.id, TEST_TOKEN);
    await uploadKycDocuments(campaign.id, TEST_TOKEN);
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Changed After Submit",
          nationalId: "9999999999999999",
          dateOfBirth: "1999-09-09",
        }),
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("campaign_not_editable");
  });
});

describe("PUT /campaigns/:id/kyc/contact", () => {
  test("saves contact fields for the owning user's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/contact`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: "Jl. Merdeka No. 1",
          city: "Bandung",
          postalCode: "40111",
        }),
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(row?.city).toBe("Bandung");
  });

  test("identity then contact populate the same row, not two rows", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/identity`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Aldi Setiawan",
          nationalId: "3271234567890001",
          dateOfBirth: "1990-05-12",
        }),
      }),
    );
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/contact`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: "Jl. Merdeka No. 1",
          city: "Bandung",
          postalCode: "40111",
        }),
      }),
    );

    const rows = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(rows.length).toBe(1);
    expect(rows[0]?.fullName).toBe("Aldi Setiawan");
    expect(rows[0]?.city).toBe("Bandung");
  });
});

describe("POST /campaigns/:id/kyc/documents/presign + /confirm", () => {
  test("returns a presigned PUT URL scoped under kyc/{campaignId}/{documentType}/", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/presign`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "ktp", fileName: "ktp.jpg" }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { uploadUrl: string; objectKey: string };
    expect(body.objectKey.startsWith(`kyc/${campaign.id}/ktp/`)).toBe(true);
    expect(body.objectKey.endsWith(".jpg")).toBe(true);
  });

  test("records the document after a real presigned upload round-trip, for both ktp and selfie", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    for (const documentType of ["ktp", "selfie"] as const) {
      const presignResp = await app.handle(
        authedRequest(
          `http://localhost/campaigns/${campaign.id}/kyc/documents/presign`,
          TEST_TOKEN,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ documentType, fileName: `${documentType}.jpg` }),
          },
        ),
      );
      const { uploadUrl, objectKey } = (await presignResp.json()) as {
        uploadUrl: string;
        objectKey: string;
      };

      const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake image bytes" });
      expect(putResp.status).toBe(200);

      const confirmResp = await app.handle(
        authedRequest(
          `http://localhost/campaigns/${campaign.id}/kyc/documents/confirm`,
          TEST_TOKEN,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ documentType, objectKey }),
          },
        ),
      );
      expect(confirmResp.status).toBe(200);
    }

    const [row] = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(row?.ktpObjectKey).not.toBeNull();
    expect(row?.selfieObjectKey).not.toBeNull();
  });

  test("rejects confirming an objectKey outside this campaign's own kyc prefix", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc/documents/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentType: "ktp",
          objectKey: "kyc/00000000-0000-0000-0000-000000000000/ktp/hijack.jpg",
        }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("404s (not 403) for a non-owner's campaign on both presign and confirm", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const presignResp = await app.handle(
      authedRequest(
        `http://localhost/campaigns/${campaign.id}/kyc/documents/presign`,
        OTHER_TOKEN,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType: "ktp", fileName: "ktp.jpg" }),
        },
      ),
    );
    expect(presignResp.status).toBe(404);
  });
});

describe("GET /campaigns/:id/kyc", () => {
  test("returns the campaign plus whatever KYC data has been saved so far, defaulting to nulls", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc`, TEST_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      campaignId: string;
      fullName: string | null;
      ktpObjectKey: string | null;
    };
    expect(body.campaignId).toBe(campaign.id);
    expect(body.fullName).toBeNull();
    expect(body.ktpObjectKey).toBeNull();
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/kyc`, OTHER_TOKEN),
    );
    expect(resp.status).toBe(404);
  });
});

describe("POST /campaigns/:id/submit", () => {
  test("flips status from draft to pending_review once identity, contact, and both documents are on file", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await fillKycIdentityAndContact(campaign.id, TEST_TOKEN);
    await uploadKycDocuments(campaign.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("pending_review");
  });

  test("rejects submission when KTP or selfie is missing", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(400);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("draft");
  });

  test("rejects submission when documents are uploaded but identity/contact were never filled in", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await uploadKycDocuments(campaign.id, TEST_TOKEN);

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("kyc_incomplete");

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("draft");
  });

  test("is safe to call again after a successful submit (does not error on an already-pending_review campaign)", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await fillKycIdentityAndContact(campaign.id, TEST_TOKEN);
    await uploadKycDocuments(campaign.id, TEST_TOKEN);
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );

    const secondResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(secondResp.status).toBe(200);
  });

  test("409s when submitting a campaign that is already active, not silently demoting it back to pending_review", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await fillKycIdentityAndContact(campaign.id, TEST_TOKEN);
    await uploadKycDocuments(campaign.id, TEST_TOKEN);
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    await db
      .update(campaigns)
      .set({ status: "active", publishedAt: new Date() })
      .where(eq(campaigns.id, campaign.id));

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("invalid_campaign_status");

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("active");
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, OTHER_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(404);
  });

  test("resubmitting after needs_revision sets submittedAt and resolves open revisions", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await fillKycIdentityAndContact(campaign.id, TEST_TOKEN);
    await uploadKycDocuments(campaign.id, TEST_TOKEN);
    await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );

    // Simulate an admin request-revision (direct DB write -- this test
    // file has no admin auth helper, and doesn't need one just to set up
    // this scenario).
    await db
      .update(campaigns)
      .set({ status: "needs_revision" })
      .where(eq(campaigns.id, campaign.id));
    const [openRevision] = await db
      .insert(campaignRevisions)
      .values({ campaignId: campaign.id, field: "cerita", note: "Perlu detail lebih." })
      .returning();

    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/submit`, TEST_TOKEN, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("pending_review");
    expect(row?.submittedAt).not.toBeNull();

    const [resolvedRevision] = await db
      .select()
      .from(campaignRevisions)
      .where(eq(campaignRevisions.id, openRevision?.id ?? ""));
    expect(resolvedRevision?.status).toBe("resolved");
    expect(resolvedRevision?.resolvedAt).not.toBeNull();
  });
});

describe("POST /campaigns idempotency", () => {
  test("submitting the same draftId twice returns the same campaign id/slug and creates only one row", async () => {
    const createDraftResp = await app.handle(
      authedRequest("http://localhost/campaign-drafts", TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ track: "medical", categoryId }),
      }),
    );
    const draft = (await createDraftResp.json()) as { id: string };
    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${draft.id}/answers`, TEST_TOKEN, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: "rangkuman",
          answers: {
            title: "Bantu Aldi Sembuh Lagi",
            purpose: "Biaya operasi jantung",
            goalAmountStr: "15000000",
          },
        }),
      }),
    );
    await app.handle(
      authedRequest(`http://localhost/campaign-drafts/${draft.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "manual", text: "Cerita lengkap Aldi." }),
      }),
    );

    const makeRequest = () =>
      app.handle(
        authedRequest("http://localhost/campaigns", TEST_TOKEN, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftId: draft.id }),
        }),
      );

    const firstResp = await makeRequest();
    expect(firstResp.status).toBe(200);
    const first = (await firstResp.json()) as { id: string; slug: string };

    const secondResp = await makeRequest();
    expect(secondResp.status).toBe(200);
    const second = (await secondResp.json()) as { id: string; slug: string };

    expect(second.id).toBe(first.id);
    expect(second.slug).toBe(first.slug);

    const rows = await db.select().from(campaigns).where(eq(campaigns.draftId, draft.id));
    expect(rows.length).toBe(1);
  });
});

describe("GET /campaigns/:id/revisions", () => {
  test("returns this campaign's revision requests, newest first", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db.insert(campaignRevisions).values([
      { campaignId: campaign.id, field: "cerita", note: "Pertama." },
      { campaignId: campaign.id, field: "target_donasi", note: "Kedua." },
    ]);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/revisions`, TEST_TOKEN),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { revisions: Array<{ field: string }> };
    expect(body.revisions).toHaveLength(2);
  });

  test("404s (not 403) for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/revisions`, OTHER_TOKEN),
    );
    expect(resp.status).toBe(404);
  });
});

describe("PUT /campaigns/:id/story", () => {
  test("updates the story while the campaign is needs_revision", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db
      .update(campaigns)
      .set({ status: "needs_revision" })
      .where(eq(campaigns.id, campaign.id));
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story: "Cerita yang sudah diperbaiki dan lebih lengkap." }),
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.story).toBe("Cerita yang sudah diperbaiki dan lebih lengkap.");
  });

  test("409s once the campaign is active", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db.update(campaigns).set({ status: "active" }).where(eq(campaigns.id, campaign.id));
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/story`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ story: "Percobaan mengubah cerita campaign aktif." }),
      }),
    );
    expect(resp.status).toBe(409);
  });
});

describe("PUT /campaigns/:id/goal-amount", () => {
  test("updates the goal amount as a real bigint", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/goal-amount`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalAmountStr: "25000000" }),
      }),
    );
    expect(resp.status).toBe(200);
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.goalAmount).toBe(25000000n);
  });

  test("rejects a malformed goalAmountStr with 400, not a 500", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/goal-amount`, TEST_TOKEN, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalAmountStr: "not-a-number" }),
      }),
    );
    expect(resp.status).toBe(422);
  });
});

describe("POST /campaigns/:id/documents/presign + /confirm", () => {
  test("presign -> real MinIO PUT -> confirm round-trip creates a campaign-scoped document row", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const presignResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/documents/presign`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "sumber_gambar", fileName: "sumber.jpg" }),
      }),
    );
    expect(presignResp.status).toBe(200);
    const { uploadUrl, objectKey } = (await presignResp.json()) as {
      uploadUrl: string;
      objectKey: string;
    };
    expect(objectKey).toStartWith(`campaigns/${campaign.id}/documents/sumber_gambar/`);

    const putResp = await fetch(uploadUrl, { method: "PUT", body: "fake image bytes" });
    expect(putResp.ok).toBe(true);

    const confirmResp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/documents/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "sumber_gambar", objectKey }),
      }),
    );
    expect(confirmResp.status).toBe(200);

    const [document] = await db
      .select()
      .from(campaignDocuments)
      .where(eq(campaignDocuments.campaignId, campaign.id));
    expect(document?.type).toBe("sumber_gambar");
    expect(document?.draftId).toBeNull();
  });

  test("confirm rejects an objectKey outside this campaign's own prefix", async () => {
    const campaignA = await createTestCampaign(TEST_TOKEN);
    const campaignB = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaignA.id}/documents/confirm`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentType: "sumber_gambar",
          objectKey: `campaigns/${campaignB.id}/documents/sumber_gambar/x.jpg`,
        }),
      }),
    );
    expect(resp.status).toBe(400);
  });

  test("404s (not 403) presign for a non-owner's campaign", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/documents/presign`, OTHER_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "sumber_gambar", fileName: "x.jpg" }),
      }),
    );
    expect(resp.status).toBe(404);
  });

  test("409s presign once the campaign is no longer editable", async () => {
    const campaign = await createTestCampaign(TEST_TOKEN);
    await db.update(campaigns).set({ status: "active" }).where(eq(campaigns.id, campaign.id));
    const resp = await app.handle(
      authedRequest(`http://localhost/campaigns/${campaign.id}/documents/presign`, TEST_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentType: "sumber_gambar", fileName: "x.jpg" }),
      }),
    );
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("campaign_not_editable");
  });
});
