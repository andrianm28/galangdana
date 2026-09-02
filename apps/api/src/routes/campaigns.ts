import {
  CampaignDetailSchema,
  CampaignErrorSchema,
  CampaignErrorSchema2c,
  CampaignListQuerySchema,
  CampaignListResponseSchema,
  CreateCampaignFromDraftBodySchema,
  CreateCampaignFromDraftResponseSchema,
} from "@galangdana/contracts";
import {
  campaignCategories,
  campaignDrafts,
  campaignStoryAnswers,
  campaigners,
  campaigns,
  db,
} from "@galangdana/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { toCampaignDetail, toCampaignSummary } from "../lib/campaign-response";
import { getOrCreateCampaignerForUser } from "../lib/campaigner";
import { sessionDerive } from "../lib/session";
import { generateUniqueSlug } from "../lib/slug";

const DEFAULT_LIMIT = 12;

export const campaignsRoute = new Elysia()
  .use(sessionDerive)
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
  .post(
    "/campaigns",
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "not_authenticated" };
      }

      const [draft] = await db
        .select()
        .from(campaignDrafts)
        .where(and(eq(campaignDrafts.id, body.draftId), eq(campaignDrafts.userId, user.id)));
      if (!draft) {
        set.status = 404;
        return { error: "draft_not_found" };
      }

      const title = typeof draft.answers.title === "string" ? draft.answers.title : null;
      const shortDescription =
        typeof draft.answers.purpose === "string" ? draft.answers.purpose : null;
      const goalAmountStr =
        typeof draft.answers.goalAmountStr === "string" ? draft.answers.goalAmountStr : null;
      if (!title || !shortDescription || !goalAmountStr || !draft.categoryId) {
        set.status = 400;
        return { error: "draft_incomplete" };
      }

      const storyAnswers = await db
        .select({
          questionNumber: campaignStoryAnswers.questionNumber,
          answerText: campaignStoryAnswers.answerText,
        })
        .from(campaignStoryAnswers)
        .where(eq(campaignStoryAnswers.draftId, draft.id));
      const story =
        storyAnswers.length > 0
          ? storyAnswers
              .sort((a, b) => a.questionNumber - b.questionNumber)
              .map((a) => a.answerText)
              .join("\n\n")
          : typeof draft.answers.story === "string"
            ? draft.answers.story
            : "";

      const campaigner = await getOrCreateCampaignerForUser(user.id);
      const slug = await generateUniqueSlug(title);

      const [campaign] = await db
        .insert(campaigns)
        .values({
          slug,
          title,
          shortDescription,
          story,
          categoryId: draft.categoryId,
          campaignerId: campaigner.id,
          type: "donation",
          currency: "IDR",
          model: "goal",
          goalAmount: BigInt(goalAmountStr),
          draftId: draft.id,
        })
        .returning();
      if (!campaign) {
        set.status = 500;
        return { error: "campaign_creation_failed" };
      }

      return { id: campaign.id, slug: campaign.slug };
    },
    {
      body: CreateCampaignFromDraftBodySchema,
      response: {
        200: CreateCampaignFromDraftResponseSchema,
        400: CampaignErrorSchema2c,
        401: CampaignErrorSchema2c,
        404: CampaignErrorSchema2c,
        500: CampaignErrorSchema2c,
      },
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
