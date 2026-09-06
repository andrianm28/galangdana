import { describe, expect, test } from "bun:test";
import {
  campaignCategories,
  campaigners,
  campaigns,
  db,
  prayers,
  sessions,
  users,
} from "@fundforindonesia/db";
import { eq } from "drizzle-orm";
import { hashSessionToken } from "../auth/session";
import { redis } from "../lib/redis-client";
import { prayersRoute } from "./prayers";

const app = prayersRoute;

async function seedActiveCampaign(slugSuffix: string, status: "active" | "draft" = "active") {
  const [category] = await db.select().from(campaignCategories).limit(1);
  const [campaigner] = await db.select().from(campaigners).limit(1);
  if (!category || !campaigner) throw new Error("seed first");
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: `prayer-test-${slugSuffix}-${Date.now()}`,
      title: "Prayer Test",
      shortDescription: "t",
      categoryId: category.id,
      campaignerId: campaigner.id,
      type: "donation",
      currency: "IDR",
      model: "goal",
      goalAmount: 1000000n,
      status,
      publishedAt: new Date(),
    })
    .returning();
  if (!campaign) throw new Error("campaign insert failed");
  return campaign;
}

describe("GET /campaigns/:slug/prayers", () => {
  test("returns an empty list for a campaign with no prayers", async () => {
    const campaign = await seedActiveCampaign("empty");
    const resp = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.slug}/prayers`),
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ prayers: [], totalCount: 0 });
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
  });

  test("404s for an unpublished campaign slug", async () => {
    const campaign = await seedActiveCampaign("draft", "draft");
    const resp = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.slug}/prayers`),
    );
    expect(resp.status).toBe(404);
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
  });
});

describe("POST /campaigns/:id/prayers", () => {
  test("publishes a prayer immediately with an Orang Baik fallback name", async () => {
    const campaign = await seedActiveCampaign("anon");
    const resp = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.id}/prayers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Semoga lekas sembuh." }),
      }),
    );
    expect(resp.status).toBe(200);
    const { id } = (await resp.json()) as { id: string };

    const list = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.slug}/prayers`),
    );
    const body = (await list.json()) as {
      prayers: { id: string; displayName: string; message: string }[];
      totalCount: number;
    };
    expect(body.totalCount).toBe(1);
    expect(body.prayers[0]?.displayName).toBe("Orang Baik");
    expect(body.prayers[0]?.message).toBe("Semoga lekas sembuh.");

    await db.delete(prayers).where(eq(prayers.id, id));
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
  });

  test("keeps a provided name and rejects overlong or empty messages", async () => {
    const campaign = await seedActiveCampaign("named");
    const resp = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.id}/prayers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hamba Allah", message: "Aamiin." }),
      }),
    );
    expect(resp.status).toBe(200);
    const { id } = (await resp.json()) as { id: string };
    const [row] = await db.select().from(prayers).where(eq(prayers.id, id));
    expect(row?.name).toBe("Hamba Allah");

    const tooLong = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.id}/prayers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "x".repeat(281) }),
      }),
    );
    expect(tooLong.status).toBe(422);

    await db.delete(prayers).where(eq(prayers.id, id));
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
  });

  test("404s for unpublished campaigns and 422s for unknown donation links", async () => {
    const draft = await seedActiveCampaign("nopub", "draft");
    const hidden = await app.handle(
      new Request(`http://localhost/campaigns/${draft.id}/prayers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Hai." }),
      }),
    );
    expect(hidden.status).toBe(404);

    const campaign = await seedActiveCampaign("baddon");
    const badLink = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.id}/prayers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Hai.",
          donationId: "00000000-0000-0000-0000-000000000000",
        }),
      }),
    );
    expect(badLink.status).toBe(422);

    await db.delete(campaigns).where(eq(campaigns.id, draft.id));
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
  });

  test("429s when the campaign's prayer budget is exhausted", async () => {
    const campaign = await seedActiveCampaign("limited");
    await redis.set(`prayer:ratelimit:${campaign.id}`, "9999");
    const resp = await app.handle(
      new Request(`http://localhost/campaigns/${campaign.id}/prayers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Hai." }),
      }),
    );
    expect(resp.status).toBe(429);
    await redis.del(`prayer:ratelimit:${campaign.id}`);
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
  });
});

describe("DELETE /admin/prayers/:id", () => {
  const ADMIN_ID = "55555555-6666-7777-8888-999999999901";
  const USER_ID = "55555555-6666-7777-8888-999999999902";
  const ADMIN_TOKEN = "prayers-admin-token";
  const USER_TOKEN = "prayers-user-token";

  async function seedUsers() {
    await db.delete(sessions).where(eq(sessions.userId, ADMIN_ID));
    await db.delete(sessions).where(eq(sessions.userId, USER_ID));
    await db.delete(users).where(eq(users.id, ADMIN_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.insert(users).values([
      { id: ADMIN_ID, phone: "+6281199990701", role: "admin" },
      { id: USER_ID, phone: "+6281199990702" },
    ]);
    await db.insert(sessions).values([
      {
        id: await hashSessionToken(ADMIN_TOKEN),
        userId: ADMIN_ID,
        expiresAt: new Date(Date.now() + 86400000),
      },
      {
        id: await hashSessionToken(USER_TOKEN),
        userId: USER_ID,
        expiresAt: new Date(Date.now() + 86400000),
      },
    ]);
  }

  function authed(url: string, token: string) {
    return new Request(url, { method: "DELETE", headers: { cookie: `session=${token}` } });
  }

  test("removes the prayer for admins, 404s unknown ids", async () => {
    await seedUsers();
    const campaign = await seedActiveCampaign("takedown");
    const [prayer] = await db
      .insert(prayers)
      .values({ campaignId: campaign.id, message: "Spam." })
      .returning();
    if (!prayer) throw new Error("prayer insert failed");

    const resp = await app.handle(
      authed(`http://localhost/admin/prayers/${prayer.id}`, ADMIN_TOKEN),
    );
    expect(resp.status).toBe(200);
    expect(await db.select().from(prayers).where(eq(prayers.id, prayer.id))).toEqual([]);

    const missing = await app.handle(
      authed(`http://localhost/admin/prayers/${prayer.id}`, ADMIN_TOKEN),
    );
    expect(missing.status).toBe(404);
    await db.delete(campaigns).where(eq(campaigns.id, campaign.id));
  });

  test("401s without a session, 403s for non-admins", async () => {
    await seedUsers();
    const anon = await app.handle(
      new Request("http://localhost/admin/prayers/00000000-0000-0000-0000-000000000000", {
        method: "DELETE",
      }),
    );
    expect(anon.status).toBe(401);
    const denied = await app.handle(
      authed("http://localhost/admin/prayers/00000000-0000-0000-0000-000000000000", USER_TOKEN),
    );
    expect(denied.status).toBe(403);
  });
});
