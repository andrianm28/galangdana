import {
  AmiinResponseSchema,
  CampaignErrorSchema,
  PrayerListQuerySchema,
  PrayerListResponseSchema,
  PublicPrayerListQuerySchema,
  PublicPrayerListResponseSchema,
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
          amiinCount: row.amiinCount,
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
  // Cross-campaign prayer feed for the homepage wall, ported from kibi-clone's
  // PrayerWall "homepage" variant.
  //
  // Note the disclosure shift, deliberately: the per-campaign endpoint answers
  // "what did people write for this campaign", which a reader already knows
  // they are looking at. This turns the same rows into a scrapeable feed across
  // every published campaign. Nothing new per item -- the fields are identical
  // plus the campaign it belongs to -- but the aggregate is new, and prayers
  // are free-text written by anyone. The same trade GET /disbursements/public
  // makes, and worth naming rather than discovering later.
  //
  // Joined to published campaigns only, so a prayer on a paused-then-unpublished
  // campaign stops appearing the moment the campaign does.
  .get(
    "/prayers/public",
    async ({ query }) => {
      const limit = query.limit ?? 20;
      const rows = await db
        .select({ prayer: prayers, campaign: campaigns })
        .from(prayers)
        .innerJoin(campaigns, eq(prayers.campaignId, campaigns.id))
        .where(inArray(campaigns.status, PUBLISHED_STATUSES))
        .orderBy(desc(prayers.createdAt))
        .limit(limit);

      const [counter] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(prayers)
        .innerJoin(campaigns, eq(prayers.campaignId, campaigns.id))
        .where(inArray(campaigns.status, PUBLISHED_STATUSES));

      return {
        prayers: rows.map(({ prayer, campaign }) => ({
          id: prayer.id,
          displayName: prayer.name ?? DEFAULT_ORANG_BAIK,
          message: prayer.message,
          amiinCount: prayer.amiinCount,
          createdAt: prayer.createdAt.toISOString(),
          campaignSlug: campaign.slug,
          campaignTitle: campaign.title,
        })),
        totalCount: counter?.count ?? 0,
      };
    },
    {
      query: PublicPrayerListQuerySchema,
      response: { 200: PublicPrayerListResponseSchema },
    },
  )
  // "Amiin" on a prayer.
  //
  // Incremented with a SQL expression, not read-modify-write: two taps landing
  // together would otherwise both read N and both write N+1, losing one. The
  // RETURNING clause gives the authoritative post-increment value back, which
  // the client needs to reconcile its optimistic update against.
  //
  // Rate-limited on the same bucket as writing a prayer. There is no account
  // behind this, so the limiter is the only thing between a warmth signal and
  // a script.
  .post(
    "/prayers/:id/amiin",
    async ({ params, set }) => {
      // Guarded by the campaign's published status, not just the prayer's
      // existence: a prayer on an unpublished campaign is not reachable in the
      // UI, so it must not be incrementable by id either. The campaign id also
      // comes out of this lookup, because the limiter buckets per campaign --
      // there is no account to bucket on.
      const [target] = await db
        .select({ id: prayers.id, campaignId: prayers.campaignId })
        .from(prayers)
        .innerJoin(campaigns, eq(prayers.campaignId, campaigns.id))
        .where(and(eq(prayers.id, params.id), inArray(campaigns.status, PUBLISHED_STATUSES)));
      if (!target) {
        set.status = 404;
        return { error: "prayer_not_found" };
      }

      // Checked AFTER the lookup on purpose: a 404 should not consume a
      // rate-limit token, or probing for ids would exhaust a real visitor's
      // budget. Same bucket and error string as writing a prayer.
      const limit = await checkPrayerRateLimit(target.campaignId);
      if (!limit.allowed) {
        set.status = 429;
        return { error: "too_many_requests" };
      }

      const [updated] = await db
        .update(prayers)
        .set({ amiinCount: sql`${prayers.amiinCount} + 1` })
        .where(eq(prayers.id, params.id))
        .returning({ id: prayers.id, amiinCount: prayers.amiinCount });

      if (!updated) {
        set.status = 404;
        return { error: "prayer_not_found" };
      }
      return { id: updated.id, amiinCount: updated.amiinCount };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: AmiinResponseSchema,
        404: CampaignErrorSchema,
        429: CampaignErrorSchema,
      },
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
