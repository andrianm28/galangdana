/**
 * Redirects every test run onto test-scoped backing services, then refuses to
 * start if the result still points anywhere near production.
 *
 * Preloaded for every `bun test` via bunfig.toml's `[test] preload`, so it runs
 * once, before any test file is imported and before any connection is opened.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo's dev and production share one database, and `bun test` writes real
 * rows. Over a single week that put 854 fabricated campaigns onto the live
 * public homepage -- "Test Campaign" and "Bantu Aldi Sembuh" outnumbering the
 * real fixtures roughly 40 to 1 -- and they had to be cleared three times,
 * because clearing them only ever treated the symptom.
 *
 * Meilisearch was worse than Postgres. campaigns-index.test.ts calls
 * syncCampaignsIndex and pruneCampaignsIndex for real, against the same index
 * the live site searches; its own comments record that `deleteAllDocuments()`
 * was "observed to wipe" production's index. Redis was quieter but not
 * harmless: test runs drained the rate-limit buckets the live API shares, which
 * was once misdiagnosed as three genuinely failing tests.
 *
 * WHY IT REWRITES RATHER THAN ONLY CHECKING
 * -----------------------------------------
 * The obvious approach is a `.env.test` file: `bun test` sets NODE_ENV=test and
 * bun layers `.env.{NODE_ENV}` over `.env`. That works -- until someone passes
 * an explicit --env-file, which REPLACES the automatic layering entirely.
 * Verified empirically, not assumed:
 *
 *     bun test                       -> .env.test wins   (isolated)
 *     bun run test                   -> .env.test wins   (isolated)
 *     bun test --env-file=.env       -> .env wins        (PRODUCTION)
 *     bun run --env-file=.env test   -> .env wins        (PRODUCTION)
 *
 * Those last two forms appear throughout this repo's own history and docs, so a
 * `.env.test` would protect the happy path and silently stop protecting the
 * moment someone copies an incantation. A `.env.test` also cannot hold
 * DATABASE_URL without committing the local Postgres password, which is a real
 * secret here and not the docker-compose default.
 *
 * Deriving the targets in this file instead is immune to how env was loaded,
 * commits no credential, and needs no per-developer setup beyond creating the
 * database once. It announces what it did, so nobody is surprised about which
 * database they just ran against.
 *
 * ONE-TIME SETUP (per machine)
 * ----------------------------
 *     bun run test:db:create     # CREATE DATABASE fundforindonesia_test
 *     bun run test:db:prepare    # migrate + seed it
 */

const SUFFIX = "_test";
const REDIS_TEST_DB = "15";

function fail(message: string): never {
  // Thrown at preload time, so the run aborts before any test opens a
  // connection -- not a per-test failure something could sail past.
  throw new Error(`\n\nREFUSING TO RUN TESTS\n\n${message}\n`);
}

const notes: string[] = [];

// --- Postgres ------------------------------------------------------------
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  fail("DATABASE_URL is not set, so there is nothing to redirect.");
}

let db: URL;
try {
  db = new URL(databaseUrl);
} catch {
  fail(`DATABASE_URL is not a valid URL: ${databaseUrl}`);
}

const dbName = db.pathname.replace(/^\//, "");
if (!dbName) {
  fail(`DATABASE_URL names no database: ${db.protocol}//.../${db.pathname}`);
}

if (!dbName.endsWith(SUFFIX)) {
  db.pathname = `/${dbName}${SUFFIX}`;
  process.env.DATABASE_URL = db.toString();
  notes.push(`postgres  ${dbName} -> ${dbName}${SUFFIX}`);
}

// Belt and braces: prove the rewrite landed, rather than trusting it.
const finalDb = new URL(process.env.DATABASE_URL as string).pathname.replace(/^\//, "");
if (!finalDb.endsWith(SUFFIX)) {
  fail(`DATABASE_URL still points at "${finalDb}", which is not a test database.`);
}

// --- Redis ---------------------------------------------------------------
// Production uses db 0, which is what an empty path means.
const redisUrl = process.env.REDIS_URL;
if (redisUrl) {
  let redis: URL;
  try {
    redis = new URL(redisUrl);
  } catch {
    fail(`REDIS_URL is not a valid URL: ${redisUrl}`);
  }
  const redisDb = redis.pathname.replace(/^\//, "");
  if (redisDb === "" || redisDb === "0") {
    redis.pathname = `/${REDIS_TEST_DB}`;
    process.env.REDIS_URL = redis.toString();
    notes.push(`redis     db ${redisDb === "" ? "0 (default)" : redisDb} -> db ${REDIS_TEST_DB}`);
  }
}

// --- Meilisearch ---------------------------------------------------------
// Indexes are global to the instance -- there is no database to switch -- so
// isolation is by index name, which packages/search reads from this variable.
const index = process.env.CAMPAIGNS_INDEX_NAME ?? "campaigns";
if (!index.endsWith(SUFFIX)) {
  process.env.CAMPAIGNS_INDEX_NAME = `${index}${SUFFIX}`;
  notes.push(`meili     ${index} -> ${index}${SUFFIX}`);
}

if (notes.length > 0) {
  console.log(`[test-setup] redirected onto test targets:\n  ${notes.join("\n  ")}`);
}
