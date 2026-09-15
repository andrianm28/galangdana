import { getMeilisearchClient } from "./client";

// Overridable because Meilisearch has no database concept -- indexes are global
// to the instance, so the only way to keep a test run out of the index the live
// site searches is to point it at a different index name. campaigns-index.test.ts
// calls syncCampaignsIndex and pruneCampaignsIndex for real against whatever this
// names. `.env.test` sets it to "campaigns_test", and test-setup.ts refuses to
// start a run where it is unset or not a _test index.
export const CAMPAIGNS_INDEX_NAME = process.env.CAMPAIGNS_INDEX_NAME ?? "campaigns";

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
 * Upserts the given documents into the campaigns index via Meilisearch's
 * `addDocuments`. This is ADDITIVE, not a full replace: documents whose
 * `id` matches an existing document are updated in place, and documents
 * with a new `id` are added, but any document already in the index that
 * is NOT present in `documents` is left untouched. Removal is NOT
 * handled by this function -- e.g. a campaign that becomes inactive (or
 * is deleted) stays searchable indefinitely until something else removes
 * it (a manual `deleteDocuments()` call, or rebuilding the index from
 * scratch some other way).
 *
 * For this phase that's fine: there is no campaign-mutation flow yet, so
 * the only caller is a from-scratch reindex script (see reindex.ts) that
 * always passes every campaign. A future phase that adds live campaign
 * creation/status changes and needs true replace semantics should reach
 * for an index-swap/alias pattern (build a new index, populate it fully,
 * then atomically swap it in), NOT an in-place `deleteAllDocuments()` +
 * `addDocuments()` here -- an in-place wipe reintroduces the exact
 * shared-index test-isolation hazard `campaigns-index.test.ts`'s
 * `afterEach` now deliberately avoids (it used to call
 * `deleteAllDocuments()` on this same shared Meilisearch index and was
 * observed intermittently wiping out real seeded data out from under
 * apps/api's GET /search test; it now deletes only its own fixture IDs).
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

/**
 * Removes documents from the campaigns index whose id is not in `keepIds`.
 *
 * `syncCampaignsIndex` is additive by design, so nothing ever left the index.
 * In production that meant 309 documents of which 301 named campaigns that had
 * been deleted -- and, worse, the eight real ones carried ids from an earlier
 * seed, so every search hit failed the hydrating join and the site answered
 * "nothing found" for every query.
 *
 * This deletes only ids it can name, one by one. It deliberately does NOT call
 * `deleteAllDocuments()`: that wipes a shared index out from under whatever
 * else is using it, which is exactly the hazard `campaigns-index.test.ts`
 * already had to be rewritten to avoid. Callers must pass the COMPLETE set of
 * ids that should survive -- which is why the only caller is the from-scratch
 * reindex script, never an incremental update path.
 */
export async function pruneCampaignsIndex(keepIds: string[]): Promise<number> {
  const client = getMeilisearchClient();
  const index = client.index(CAMPAIGNS_INDEX_NAME);
  const keep = new Set(keepIds);

  const stale: string[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await index.getDocuments({ limit: pageSize, offset, fields: ["id"] });
    for (const doc of page.results as Array<{ id: string }>) {
      if (!keep.has(doc.id)) stale.push(doc.id);
    }
    if (page.results.length < pageSize) break;
  }
  if (stale.length === 0) return 0;

  const task = await index.deleteDocuments(stale);
  const result = await client.tasks.waitForTask(task.taskUid);
  if (result.status !== "succeeded") {
    throw new Error(`campaigns index prune failed: ${JSON.stringify(result.error)}`);
  }
  return stale.length;
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
