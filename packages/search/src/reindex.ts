import { campaignCategories, campaigns, db } from "@fundforindonesia/db";
import { eq } from "drizzle-orm";
import { syncCampaignsIndex } from "./campaigns-index";

async function reindex(): Promise<void> {
  const rows = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      title: campaigns.title,
      shortDescription: campaigns.shortDescription,
      categoryId: campaigns.categoryId,
      categorySlug: campaignCategories.slug,
      model: campaigns.model,
      createdAt: campaigns.createdAt,
      status: campaigns.status,
    })
    .from(campaigns)
    .innerJoin(campaignCategories, eq(campaigns.categoryId, campaignCategories.id));

  const documents = rows
    .filter((r) => r.status === "active")
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      shortDescription: r.shortDescription,
      categoryId: r.categoryId,
      categorySlug: r.categorySlug,
      model: r.model,
      createdAtMs: r.createdAt.getTime(),
    }));

  await syncCampaignsIndex(documents);
  console.log(`Reindexed ${documents.length} active campaigns into Meilisearch.`);
}

if (import.meta.main) {
  await reindex();
  process.exit(0);
}

export { reindex };
