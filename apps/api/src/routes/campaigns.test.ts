import { beforeAll, describe, expect, test } from "bun:test";
import {
  campaignCategories,
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
