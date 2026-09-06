import {
  CampaignErrorSchema,
  PrayerListQuerySchema,
  PrayerListResponseSchema,
  SubmitPrayerBodySchema,
  SubmitPrayerResponseSchema,
} from "@fundforindonesia/contracts";
import { campaigns, db, donations, prayers } from "@fundforindonesia/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { checkPrayerRateLimit } from "../auth/rate-limit";
import { checkAdmin } from "../lib/admin";
import { sessionDerive } from "../lib/session";

const DEFAULT_ORANG_BAIK = "Orang Baik";

// Same published set as GET /campaigns/:slug (see campaigns.ts
// PUBLISHED_STATUSES): prayers exist only where a public page exists.
const PUBLISHED_STATUSES: Array<"active" | "paused" | "completed"> = [
  "active",
  "paused",
  "completed",
];

export const prayersRoute = new Elysia()
  .use(sessionDerive)
  .get(
    "/campaigns/:slug/prayers",
    async ({ params, query, set }) => {
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.slug, params.slug), inArray(campaigns.status, PUBLISHED_STATUSES)));
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }
      const limit = query.limit ?? 20;
      const rows = await db
        .select()
        .from(prayers)
        .where(eq(prayers.campaignId, campaign.id))
        .orderBy(desc(prayers.createdAt))
        .limit(limit);
      const [counter] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(prayers)
        .where(eq(prayers.campaignId, campaign.id));
      return {
        prayers: rows.map((row) => ({
          id: row.id,
          displayName: row.name ?? DEFAULT_ORANG_BAIK,
          message: row.message,
          createdAt: row.createdAt.toISOString(),
        })),
        totalCount: counter?.count ?? 0,
      };
    },
    {
      params: t.Object({ slug: t.String() }),
      query: PrayerListQuerySchema,
      response: { 200: PrayerListResponseSchema, 404: CampaignErrorSchema },
    },
  )
  .post(
    "/campaigns/:id/prayers",
    async ({ params, body, set }) => {
      // Published-only, like the GET above: accepting prayers for a draft
      // would confirm an unpublished campaign exists (and collect spam on
      // a page nobody can see). 404, not 403, for the same reason.
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.id, params.id), inArray(campaigns.status, PUBLISHED_STATUSES)));
      if (!campaign) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      const prayerLimit = await checkPrayerRateLimit(campaign.id);
      if (!prayerLimit.allowed) {
        set.status = 429;
        return { error: "too_many_requests" };
      }

      if (body.donationId) {
        const [donation] = await db
          .select({ id: donations.id })
          .from(donations)
          .where(and(eq(donations.id, body.donationId), eq(donations.campaignId, campaign.id)));
        if (!donation) {
          set.status = 422;
          return { error: "invalid_donation" };
        }
      }

      const [prayer] = await db
        .insert(prayers)
        .values({
          campaignId: campaign.id,
          donationId: body.donationId,
          name: body.name?.trim() ? body.name.trim() : null,
          message: body.message.trim(),
        })
        .returning();
      if (!prayer) {
        set.status = 500;
        return { error: "prayer_submit_failed" };
      }
      return { id: prayer.id };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: SubmitPrayerBodySchema,
      response: {
        200: SubmitPrayerResponseSchema,
        404: CampaignErrorSchema,
        422: CampaignErrorSchema,
        429: CampaignErrorSchema,
        500: CampaignErrorSchema,
      },
    },
  )
  .delete(
    "/admin/prayers/:id",
    async ({ user, params, set }) => {
      const adminError = checkAdmin(user);
      if (adminError) {
        set.status = adminError.status;
        return { error: adminError.status === 401 ? "not_authenticated" : "not_authorized" };
      }
      const deleted = await db.delete(prayers).where(eq(prayers.id, params.id)).returning();
      if (deleted.length === 0) {
        set.status = 404;
        return { error: "prayer_not_found" };
      }
      return { status: "deleted" as const };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ status: t.String() }),
        401: CampaignErrorSchema,
        403: CampaignErrorSchema,
        404: CampaignErrorSchema,
      },
    },
  );
