import { campaignCategories, campaigns, db } from "@fundforindonesia/db";
import { eq } from "drizzle-orm";
import { pruneCampaignsIndex, syncCampaignsIndex } from "./campaigns-index";

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
  // syncCampaignsIndex only ever adds. Without this, a campaign that was
  // deleted or deactivated stays searchable forever, and the index drifts
  // further from the database on every run.
  const pruned = await pruneCampaignsIndex(documents.map((d) => d.id));
  const prunedNote = pruned > 0 ? `, pruned ${pruned} stale document(s).` : ".";
  console.log(`Reindexed ${documents.length} active campaigns into Meilisearch${prunedNote}`);
}

if (import.meta.main) {
  await reindex();
  process.exit(0);
}

export { reindex };
