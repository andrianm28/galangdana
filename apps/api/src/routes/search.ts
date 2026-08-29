import { SearchQuerySchema, SearchResponseSchema } from "@galangdana/contracts";
import { campaignCategories, campaigners, campaigns, db } from "@galangdana/db";
import { searchCampaigns } from "@galangdana/search";
import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { toCampaignSummary } from "../lib/campaign-response";

export const searchRoute = new Elysia().get(
  "/search",
  async ({ query }) => {
    let categoryId: number | undefined;
    if (query.category) {
      const [category] = await db
        .select()
        .from(campaignCategories)
        .where(eq(campaignCategories.slug, query.category));
      categoryId = category?.id;
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
        inArray(
          campaigns.id,
          hits.map((h) => h.id),
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
  { query: SearchQuerySchema, response: { 200: SearchResponseSchema } },
);
