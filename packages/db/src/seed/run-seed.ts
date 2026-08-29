import { db } from "../client";
import { campaignCategories } from "../schema/categories";
import { CATEGORY_SEED_DATA } from "./categories.seed";

async function runSeed() {
  await db
    .insert(campaignCategories)
    .values(CATEGORY_SEED_DATA)
    .onConflictDoNothing({ target: campaignCategories.id });
  console.log(`Seeded ${CATEGORY_SEED_DATA.length} categories.`);
}

if (import.meta.main) {
  await runSeed();
  process.exit(0);
}

export { runSeed };
