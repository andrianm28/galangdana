import { getMeilisearchClient } from "./client";

export const CAMPAIGNS_INDEX_NAME = "campaigns";

export interface CampaignSearchDocument {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  categoryId: number;
  categorySlug: string;
  model: "goal" | "program";
  createdAtMs: number;
}

/**
 * Replaces the entire campaigns index with the given documents. Full
 * replace (not incremental upsert) is the right shape for this phase:
 * there is no campaign-creation flow yet, so the only caller is a
 * from-scratch reindex script (see reindex.ts). A future phase that adds
 * live campaign creation should add an incremental
 * index.addDocuments([one document]) call at the write site instead of
 * calling this on every write.
 */
export async function syncCampaignsIndex(documents: CampaignSearchDocument[]): Promise<void> {
  const client = getMeilisearchClient();
  const index = client.index(CAMPAIGNS_INDEX_NAME);

  const filterableTask = await index.updateFilterableAttributes([
    "categoryId",
    "categorySlug",
    "model",
  ]);
  await client.tasks.waitForTask(filterableTask.taskUid);
  const sortableTask = await index.updateSortableAttributes(["createdAtMs"]);
  await client.tasks.waitForTask(sortableTask.taskUid);

  // primaryKey MUST be specified explicitly -- verified during this
  // plan's research that Meilisearch's auto-inference gets confused when
  // a document has multiple fields ending in "id" ("id" and
  // "categoryId" here) and the indexing task fails silently (status:
  // "failed" on the task, no thrown exception) rather than picking one.
  const task = await index.addDocuments(documents, { primaryKey: "id" });
  const result = await client.tasks.waitForTask(task.taskUid);
  if (result.status !== "succeeded") {
    throw new Error(`campaigns index sync failed: ${JSON.stringify(result.error)}`);
  }
}

export interface SearchCampaignsOptions {
  categoryId?: number;
  limit?: number;
}

export async function searchCampaigns(
  query: string,
  opts: SearchCampaignsOptions = {},
): Promise<CampaignSearchDocument[]> {
  const client = getMeilisearchClient();
  const index = client.index<CampaignSearchDocument>(CAMPAIGNS_INDEX_NAME);
  const filter = opts.categoryId !== undefined ? `categoryId = ${opts.categoryId}` : undefined;
  const results = await index.search(query, { filter, limit: opts.limit ?? 20 });
  return results.hits;
}
