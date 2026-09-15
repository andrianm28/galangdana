/**
 * One-time setup for the test database that test-setup.ts redirects onto.
 *
 *   bun run test:db:create    -- CREATE DATABASE <name>_test
 *   bun run test:db:prepare   -- migrate it, then seed it
 *
 * Both derive the target from DATABASE_URL the same way test-setup.ts does, so
 * there is one rule about what "the test database" means and it lives in code
 * rather than in a committed connection string. That matters here: the local
 * Postgres password is a real secret from .env, not the docker-compose default,
 * so it must not end up in a committed .env.test.
 */
import { $ } from "bun";
import postgres from "postgres";

const SUFFIX = "_test";
// Must match what test-setup.ts derives, or prepare would populate one index
// and the tests would read another.
const TEST_INDEX = `campaigns${SUFFIX}`;

const raw = process.env.DATABASE_URL;
if (!raw) {
  throw new Error("DATABASE_URL is not set. Run from the repo root with .env loaded.");
}

const url = new URL(raw);
const baseName = url.pathname.replace(/^\//, "");
const testName = baseName.endsWith(SUFFIX) ? baseName : `${baseName}${SUFFIX}`;

const testUrl = new URL(url.toString());
testUrl.pathname = `/${testName}`;

async function create(): Promise<void> {
  // CREATE DATABASE cannot run inside a transaction, and cannot target the
  // database you are connected to -- hence the maintenance connection.
  const admin = new URL(url.toString());
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1 });
  try {
    const [existing] = await sql`select 1 as ok from pg_database where datname = ${testName}`;
    if (existing) {
      console.log(`${testName} already exists`);
      return;
    }
    await sql.unsafe(`CREATE DATABASE "${testName}"`);
    console.log(`created ${testName}`);
  } finally {
    await sql.end();
  }
}

async function prepare(): Promise<void> {
  await create();
  // Child processes inherit the rewritten URL, so migrate and seed cannot
  // wander back onto the dev database.
  const env = { ...process.env, DATABASE_URL: testUrl.toString() };
  // cwd matters: migrate.ts resolves its migrations folder relative to the
  // working directory, so running it from the repo root finds no _journal.json.
  const pkgRoot = `${import.meta.dir}/..`;
  console.log(`migrating ${testName}`);
  await $`bun run src/migrate.ts`.cwd(pkgRoot).env(env);
  console.log(`seeding ${testName}`);
  await $`bun run src/seed/run-seed.ts`.cwd(pkgRoot).env(env);

  // GET /search hits Meilisearch for real, so the test index has to hold the
  // test database's campaigns or the typo-tolerance test fails against an empty
  // index. CAMPAIGNS_INDEX_NAME is set here for the same reason test-setup.ts
  // sets it: indexes are global to the instance, and the default name is the
  // one the live site searches.
  const searchEnv = { ...env, CAMPAIGNS_INDEX_NAME: TEST_INDEX };
  console.log(`reindexing ${TEST_INDEX}`);
  await $`bun run src/reindex.ts`.cwd(`${pkgRoot}/../search`).env(searchEnv);

  console.log(`${testName} ready`);
}

const mode = process.argv[2];
if (mode === "create") {
  await create();
} else if (mode === "prepare") {
  await prepare();
} else {
  throw new Error(`unknown mode ${mode ?? "(none)"} -- expected "create" or "prepare"`);
}
