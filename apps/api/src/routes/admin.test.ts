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
});
