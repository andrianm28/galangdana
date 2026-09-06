import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CAMPAIGNS_INDEX_NAME,
  pruneCampaignsIndex,
  searchCampaigns,
  syncCampaignsIndex,
} from "./campaigns-index";
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
    // Deletes only this suite's own fixture IDs, not deleteAllDocuments():
    // this index is real, shared infrastructure (Meilisearch, no mocking,
    // per this codebase's testing philosophy) -- CI and `bun run reindex`
    // populate it with real seeded campaign data that apps/api's
    // GET /search test (search.test.ts) depends on, and `bun test`'s
    // per-file execution order/concurrency is not guaranteed (see the
    // "Seed database" step's comment in ci.yml for the same caveat about
    // Postgres) -- deleteAllDocuments() here was observed to wipe that
    // real data out from under a concurrently/later-running
    // apps/api/src/routes/search.test.ts, failing it with an empty index
    // and no indication why.
    const client = getMeilisearchClient();
    const task = await client
      .index(CAMPAIGNS_INDEX_NAME)
      .deleteDocuments(TEST_DOCS.map((d) => d.id));
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
    // Asserts every hit actually has categoryId 8 (proving the filter
    // works) and that this suite's own fixture is among them, rather than
    // an exact results.length: with the codebase's real seed data sharing
    // this same real Meilisearch index (categoryId 8 is a real seeded
    // category, "balita-anak-sakit" -- see packages/db's
    // categories.seed.ts/campaigns.seed.ts), a real seeded campaign can
    // legitimately also have categoryId 8, and an exact-count assertion
    // would be an accidental coupling to seed-data contents rather than a
    // real test of filtering behavior.
    const results = await searchCampaigns("", { categoryId: 8 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.categoryId === 8)).toBe(true);
    expect(results.some((r) => r.slug === "test-anak-sakit")).toBe(true);
  });
});

describe("pruneCampaignsIndex", () => {
  // syncCampaignsIndex only adds. Production accumulated 309 documents of
  // which 301 named campaigns that no longer existed, and the eight real ones
  // carried ids from an earlier seed -- so every search hit failed the
  // hydrating join and the site answered "nothing found" for every query.
  const KEEP = TEST_DOCS[0] as (typeof TEST_DOCS)[number];
  const DROP = TEST_DOCS[1] as (typeof TEST_DOCS)[number];

  test("removes a document whose id is not in the keep set", async () => {
    await syncCampaignsIndex(TEST_DOCS);
    const client = getMeilisearchClient();
    const index = client.index(CAMPAIGNS_INDEX_NAME);

    const before = await index.getDocuments({ limit: 1000, fields: ["id"] });
    const keepIds = (before.results as Array<{ id: string }>)
      .map((d) => d.id)
      .filter((id) => id !== DROP.id);

    const pruned = await pruneCampaignsIndex(keepIds);
    expect(pruned).toBe(1);

    const results = await searchCampaigns("Anak Sakit");
    expect(results.some((r) => r.slug === DROP.slug)).toBe(false);
  });

  test("leaves everything alone when nothing is stale", async () => {
    await syncCampaignsIndex(TEST_DOCS);
    const client = getMeilisearchClient();
    const index = client.index(CAMPAIGNS_INDEX_NAME);
    const all = await index.getDocuments({ limit: 1000, fields: ["id"] });

    const pruned = await pruneCampaignsIndex(
      (all.results as Array<{ id: string }>).map((d) => d.id),
    );
    expect(pruned).toBe(0);

    const results = await searchCampaigns("Banjir Jakarta");
    expect(results.some((r) => r.slug === KEEP.slug)).toBe(true);
  });
});
