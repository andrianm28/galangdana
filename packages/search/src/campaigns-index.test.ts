import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CAMPAIGNS_INDEX_NAME, searchCampaigns, syncCampaignsIndex } from "./campaigns-index";
import { getMeilisearchClient } from "./client";

const TEST_DOCS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "test-banjir-jakarta",
    title: "Bantu Korban Banjir Jakarta",
    shortDescription: "Test fixture",
    categoryId: 22,
    categorySlug: "bencana-alam",
    model: "goal" as const,
    createdAtMs: 1000,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    slug: "test-anak-sakit",
    title: "Bantu Pengobatan Anak Sakit",
    shortDescription: "Test fixture",
    categoryId: 8,
    categorySlug: "balita-anak-sakit",
    model: "goal" as const,
    createdAtMs: 2000,
  },
];

describe("campaigns search index", () => {
  beforeEach(async () => {
    await syncCampaignsIndex(TEST_DOCS);
  });

  afterEach(async () => {
    const client = getMeilisearchClient();
    const task = await client.index(CAMPAIGNS_INDEX_NAME).deleteAllDocuments();
    await client.tasks.waitForTask(task.taskUid);
  });

  test("indexes documents with an explicit primary key -- required because 'id' and 'categoryId' both end in 'id', which breaks Meilisearch's auto-inference", async () => {
    // This test's own existence is the regression guard: verified during
    // this plan's research that omitting an explicit primaryKey on a
    // document shaped like this makes the indexing TASK silently fail
    // (status: "failed", not a thrown error) with
    // "index_primary_key_multiple_candidates_found" -- a caller that
    // doesn't check task status would see an empty search index with no
    // visible error at all.
    const results = await searchCampaigns("banjir jakarta");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.slug).toBe("test-banjir-jakarta");
  });

  test("search is typo-tolerant", async () => {
    const results = await searchCampaigns("banjir jakrta"); // deliberate typo
    expect(results.some((r) => r.slug === "test-banjir-jakarta")).toBe(true);
  });

  test("filters by categoryId", async () => {
    const results = await searchCampaigns("", { categoryId: 8 });
    expect(results.length).toBe(1);
    expect(results[0]?.slug).toBe("test-anak-sakit");
  });
});
