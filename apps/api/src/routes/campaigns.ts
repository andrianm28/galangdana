import {
  CampaignDetailSchema,
  CampaignErrorSchema,
  CampaignListQuerySchema,
  CampaignListResponseSchema,
} from "@galangdana/contracts";
import { campaignCategories, campaigners, campaigns, db } from "@galangdana/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { toCampaignDetail, toCampaignSummary } from "../lib/campaign-response";

const DEFAULT_LIMIT = 12;

export const campaignsRoute = new Elysia()
  .get(
    "/campaigns",
    async ({ query, set }) => {
      const page = query.page ?? 1;
      const limit = query.limit ?? DEFAULT_LIMIT;
      const offset = (page - 1) * limit;

      const conditions = [eq(campaigns.status, "active")];
      if (query.category) {
        const [category] = await db
          .select()
          .from(campaignCategories)
          .where(eq(campaignCategories.slug, query.category));
        if (!category) {
          set.status = 404;
          return { error: "category_not_found" };
        }
        conditions.push(eq(campaigns.categoryId, category.id));
      }
      if (query.campaignerType) {
        conditions.push(eq(campaigners.type, query.campaignerType));
      }

      // "urgent": goal-model campaigns with the soonest deadline first;
      // program-model campaigns (expiresAt is always NULL for them) sort
      // last, since "urgency" has no meaning without a deadline. NULLS
      // LAST is Postgres's default for ASC, but stated explicitly here so
      // the intent survives a future sort-expression refactor.
      const orderBy =
        query.sort === "urgent"
          ? [sql`${campaigns.expiresAt} ASC NULLS LAST`]
          : [desc(campaigns.publishedAt)];

      const whereClause = and(...conditions);

      const [rows, countRows] = await Promise.all([
        db
          .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
          .from(campaigns)
          .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
          .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
          .where(whereClause)
          .orderBy(...orderBy)
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
          .where(whereClause),
      ]);
      // count(*) with no GROUP BY always returns exactly one row (count: 0
      // for no matches), so this fallback is unreachable in practice -- it
      // exists only to satisfy noUncheckedIndexedAccess without an unsafe
      // non-null assertion, matching the `if (!category)` guard style above.
      const count = countRows[0]?.count ?? 0;

      const summaries = await Promise.all(rows.map(toCampaignSummary));

      return {
        campaigns: summaries,
        page,
        totalPages: Math.max(1, Math.ceil(count / limit)),
        totalCount: count,
      };
    },
    {
      query: CampaignListQuerySchema,
      response: { 200: CampaignListResponseSchema, 404: CampaignErrorSchema },
    },
  )
  .get(
    "/campaigns/:slug",
    async ({ params, set }) => {
      const [row] = await db
        .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
        .from(campaigns)
        .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
        .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
        .where(and(eq(campaigns.slug, params.slug), eq(campaigns.status, "active")));

      if (!row) {
        set.status = 404;
        return { error: "campaign_not_found" };
      }

      return toCampaignDetail(row);
    },
    { response: { 200: CampaignDetailSchema, 404: CampaignErrorSchema } },
  );
