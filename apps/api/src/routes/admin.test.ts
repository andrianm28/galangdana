import { beforeAll, describe, expect, test } from "bun:test";
import {
  campaignCategories,
  campaignDocuments,
  campaignDrafts,
  campaignRevisions,
  campaigners,
  campaigns,
  db,
  individualVerifications,
  sessions,
  users,
} from "@fundforindonesia/db";
import { eq, inArray } from "drizzle-orm";
import { adminRoute } from "./admin";

const app = adminRoute;

// Sessions are inserted directly into the sessions table with a fixed
// token as the row id -- no real OTP/login round trip needed in a test.
// Matches the exact pattern already established in campaigns.test.ts
// (TEST_USER_ID/TEST_TOKEN inserted directly in beforeAll).
const ADMIN_USER_ID = "44444444-5555-6666-7777-888888888803";
const CAMPAIGNER_USER_ID = "44444444-5555-6666-7777-888888888804";
const ADMIN_TOKEN = "admin-test-token";
const CAMPAIGNER_TOKEN = "admin-test-campaigner-token";

function authedRequest(url: string, token: string, init: RequestInit = {}) {
  return new Request(url, { ...init, headers: { ...init.headers, cookie: `session=${token}` } });
}

beforeAll(async () => {
  await db.delete(users).where(inArray(users.id, [ADMIN_USER_ID, CAMPAIGNER_USER_ID]));
  await db.insert(users).values([
    { id: ADMIN_USER_ID, phone: "+6281199000001", role: "admin" },
    { id: CAMPAIGNER_USER_ID, phone: "+6281199000002", role: "campaigner" },
  ]);
  await db.insert(sessions).values([
    { id: ADMIN_TOKEN, userId: ADMIN_USER_ID, expiresAt: new Date(Date.now() + 86400000) },
    {
      id: CAMPAIGNER_TOKEN,
      userId: CAMPAIGNER_USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
  ]);
});

async function seedPendingCampaign() {
  const [category] = await db.select().from(campaignCategories).limit(1);
  if (!category) throw new Error("no seeded category -- run db seed first");
  const [campaigner] = await db
    .insert(campaigners)
    .values({ type: "individual", displayName: "Aldi Setiawan" })
    .returning();
  if (!campaigner) throw new Error("campaigner insert failed");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `admin-test-${crypto.randomUUID()}`,
      title: "Bantu Aldi Sembuh",
      shortDescription: "desc",
      categoryId: category.id,
      campaignerId: campaigner.id,
      model: "goal",
      goalAmount: 5000000n,
      // A real goal-model campaign set up through the wizard has a
      // deadline by the time it's submitted; POST /admin/campaigns/:id/
      // approve doesn't touch expiresAt (that's set at campaign creation,
      // not approval), so a null value here stays null through every test
      // in this file that approves this fixture -- and null expiresAt on
      // an active goal campaign corrupts apps/api's campaigns.test.ts
      // sort=urgent assertion whenever this row is still present in the
      // shared test database.
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: "pending_review",
      submittedAt: new Date(),
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  await db.insert(individualVerifications).values({
    campaignId: campaign.id,
    fullName: "Aldi Setiawan",
    nationalId: "3271234567890001",
    dateOfBirth: "1990-05-12",
    address: "Jl. Merdeka No. 1",
    city: "Bandung",
    postalCode: "40111",
    ktpObjectKey: `kyc/${campaign.id}/ktp/x.jpg`,
    selfieObjectKey: `kyc/${campaign.id}/selfie/y.jpg`,
  });
  return campaign;
}

describe("GET /admin/campaigns", () => {
  test("401s for an unauthenticated request", async () => {
    const resp = await app.handle(new Request("http://localhost/admin/campaigns"));
    expect(resp.status).toBe(401);
  });

  test("403s for an authenticated non-admin", async () => {
    const token = CAMPAIGNER_TOKEN;
    const resp = await app.handle(authedRequest("http://localhost/admin/campaigns", token));
    expect(resp.status).toBe(403);
  });

  test("lists pending_review campaigns for an admin, with campaigner and category names", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(authedRequest("http://localhost/admin/campaigns", token));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      campaigns: Array<{ id: string; campaignerName: string }>;
    };
    const found = body.campaigns.find((c) => c.id === campaign.id);
    expect(found?.campaignerName).toBe("Aldi Setiawan");
  });
});

describe("GET /admin/campaigns/:id", () => {
  test("404s for a nonexistent campaign", async () => {
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${crypto.randomUUID()}`, token),
    );
    expect(resp.status).toBe(404);
  });

  test("returns full detail including presigned, non-empty KTP/selfie view URLs", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}`, token),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      verification: { ktpViewUrl: string | null; selfieViewUrl: string | null; fullName: string };
    };
    expect(body.verification.fullName).toBe("Aldi Setiawan");
    expect(body.verification.ktpViewUrl).toMatch(/^https?:\/\//);
    expect(body.verification.selfieViewUrl).toMatch(/^https?:\/\//);
  });

  test("includes a draft-scoped document that was never re-pointed to the campaign", async () => {
    const campaign = await seedPendingCampaign();

    // Mirrors POST /campaigns: campaigns.draftId points back at the draft
    // the wizard was submitted from, but campaign_documents rows written
    // during that wizard flow keep draftId set and campaignId NULL forever
    // -- nothing ever re-points them (see this task's brief).
    const [draft] = await db
      .insert(campaignDrafts)
      .values({
        userId: CAMPAIGNER_USER_ID,
        track: "non_medical",
        expiresAt: new Date(Date.now() + 86400000),
      })
      .returning();
    if (!draft) throw new Error("draft insert failed");
    await db.update(campaigns).set({ draftId: draft.id }).where(eq(campaigns.id, campaign.id));
    await db.insert(campaignDocuments).values({
      draftId: draft.id,
      type: "kartu_mahasiswa",
      objectKey: `drafts/${draft.id}/kartu_mahasiswa/x.jpg`,
    });

    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}`, token),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      documents: Array<{ type: string; viewUrl: string }>;
    };
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]?.type).toBe("kartu_mahasiswa");
    expect(body.documents[0]?.viewUrl).toMatch(/^https?:\/\//);
  });
});

describe("POST /admin/campaigns/:id/approve", () => {
  test("403s for a non-admin", async () => {
    const campaign = await seedPendingCampaign();
    const token = CAMPAIGNER_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/approve`, token, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(403);
  });

  test("flips status to active, sets publishedAt, and marks KYC verified", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/approve`, token, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("active");
    expect(row?.publishedAt).not.toBeNull();

    const [verification] = await db
      .select()
      .from(individualVerifications)
      .where(eq(individualVerifications.campaignId, campaign.id));
    expect(verification?.status).toBe("verified");
  });

  test("409s when the campaign isn't pending_review", async () => {
    const campaign = await seedPendingCampaign();
    // publishedAt matters here, not just status: a real approve sets it,
    // and GET /campaigns's default + "newest" sort order by it DESC. A
    // null publishedAt sorts first under Postgres's NULLS FIRST default,
    // which previously corrupted campaigns.test.ts's sort assertions
    // whenever this row was still present in the shared test database.
    await db
      .update(campaigns)
      .set({
        status: "active",
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(eq(campaigns.id, campaign.id));
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/approve`, token, {
        method: "POST",
      }),
    );
    expect(resp.status).toBe(409);
  });

  test("a second approve attempt 409s instead of silently re-approving", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const url = `http://localhost/admin/campaigns/${campaign.id}/approve`;

    const first = await app.handle(authedRequest(url, token, { method: "POST" }));
    expect(first.status).toBe(200);
    const [afterFirst] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    const publishedAtAfterFirst = afterFirst?.publishedAt?.toISOString();

    const second = await app.handle(authedRequest(url, token, { method: "POST" }));
    expect(second.status).toBe(409);

    const [afterSecond] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(afterSecond?.publishedAt?.toISOString()).toBe(publishedAtAfterFirst);
  });
});

describe("POST /admin/campaigns/:id/request-revision", () => {
  test("flips status to needs_revision and creates open revision rows", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const resp = await app.handle(
      authedRequest(`http://localhost/admin/campaigns/${campaign.id}/request-revision`, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            { field: "cerita", note: "Cerita terlalu singkat, tambahkan detail." },
            { field: "sumber_gambar", note: "Sertakan sumber foto." },
          ],
        }),
      }),
    );
    expect(resp.status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("needs_revision");

    const revisions = await db
      .select()
      .from(campaignRevisions)
      .where(eq(campaignRevisions.campaignId, campaign.id));
    expect(revisions).toHaveLength(2);
    expect(revisions.every((r) => r.status === "open")).toBe(true);
  });

  test("a second request-revision attempt 409s and does not insert duplicate revisions", async () => {
    const campaign = await seedPendingCampaign();
    const token = ADMIN_TOKEN;
    const url = `http://localhost/admin/campaigns/${campaign.id}/request-revision`;
    const requestBody = JSON.stringify({
      items: [{ field: "cerita", note: "Cerita terlalu singkat, tambahkan detail." }],
    });

    const first = await app.handle(
      authedRequest(url, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      authedRequest(url, token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      }),
    );
    expect(second.status).toBe(409);

    const revisions = await db
      .select()
      .from(campaignRevisions)
      .where(eq(campaignRevisions.campaignId, campaign.id));
    expect(revisions).toHaveLength(1);
  });
});
