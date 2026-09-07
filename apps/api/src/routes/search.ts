import {
  CampaignErrorSchema,
  SearchQuerySchema,
  SearchResponseSchema,
} from "@fundforindonesia/contracts";
import { campaignCategories, campaigners, campaigns, db } from "@fundforindonesia/db";
import { searchCampaigns } from "@fundforindonesia/search";
import { and, eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { toCampaignSummary } from "../lib/campaign-response";

export const searchRoute = new Elysia().get(
  "/search",
  async ({ query, set }) => {
    let categoryId: number | undefined;
    if (query.category) {
      // Same isActive filter as GET /campaigns's slug->id lookup: an
      // archived category (e.g. zakat/wakaf) must 404 below, not silently
      // resolve to an id and search with it -- without this filter an
      // archived slug would still work via search even though it's gone
      // from /categories and from GET /campaigns.
      const [category] = await db
        .select()
        .from(campaignCategories)
        .where(
          and(eq(campaignCategories.slug, query.category), eq(campaignCategories.isActive, true)),
        );
      if (!category) {
        set.status = 404;
        return { error: "category_not_found" };
      }
      categoryId = category.id;
    }

    const hits = await searchCampaigns(query.q, { categoryId });
    if (hits.length === 0) {
      return { results: [], query: query.q };
    }

    const rows = await db
      .select({ campaign: campaigns, category: campaignCategories, campaigner: campaigners })
      .from(campaigns)
      .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id))
      .innerJoin(campaigners, eq(campaigns.campaignerId, campaigners.id))
      .where(
        and(
          inArray(
            campaigns.id,
            hits.map((h) => h.id),
          ),
          // Defensive layering, not currently reachable: no
          // campaign-mutation flow exists yet in this phase, so nothing can
          // make an indexed campaign non-active. Still, this endpoint
          // shouldn't rely solely on the Meilisearch index never containing
          // a non-active campaign -- matches the same eq(campaigns.status,
          // "active") condition GET /campaigns and GET /campaigns/:slug
          // already apply (see campaigns.ts).
          eq(campaigns.status, "active"),
        ),
      );

    // Preserve Meilisearch's own relevance ordering -- the Postgres
    // inArray() query above has no guaranteed row order, so re-sort the
    // hydrated rows to match the order `hits` came back in.
    const orderById = new Map(hits.map((h, i) => [h.id, i]));
    const orderedRows = [...rows].sort(
      (a, b) => (orderById.get(a.campaign.id) ?? 0) - (orderById.get(b.campaign.id) ?? 0),
    );

    const results = await Promise.all(orderedRows.map(toCampaignSummary));
    return { results, query: query.q };
  },
  {
    query: SearchQuerySchema,
    response: { 200: SearchResponseSchema, 404: CampaignErrorSchema },
  },
);
