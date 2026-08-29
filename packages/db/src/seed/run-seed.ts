import { eq } from "drizzle-orm";
import { db } from "../client";
import { campaigners } from "../schema/campaigners";
import { campaigns } from "../schema/campaigns";
import { campaignCategories } from "../schema/categories";
import { CAMPAIGNER_SEED_DATA } from "./campaigners.seed";
import { CAMPAIGN_SEED_DATA } from "./campaigns.seed";
import { CATEGORY_SEED_DATA } from "./categories.seed";

async function runSeed() {
  await db
    .insert(campaignCategories)
    .values(CATEGORY_SEED_DATA)
    .onConflictDoNothing({ target: campaignCategories.id });
  console.log(`Seeded ${CATEGORY_SEED_DATA.length} categories.`);

  // Campaigners have no natural unique business key to conflict-detect on
  // (displayName isn't declared unique at the schema level -- two real
  // campaigners could share a name), so re-running this script is safe
  // only because it looks up existing rows by name first rather than
  // blindly re-inserting. This is a fixture-seeding convenience, not a
  // pattern real campaigner creation should copy.
  const campaignerIdByName = new Map<string, string>();
  for (const seed of CAMPAIGNER_SEED_DATA) {
    const [existing] = await db
      .select()
      .from(campaigners)
      .where(eq(campaigners.displayName, seed.displayName));
    if (existing) {
      campaignerIdByName.set(seed.displayName, existing.id);
      continue;
    }
    const [created] = await db.insert(campaigners).values(seed).returning();
    if (!created) throw new Error(`failed to insert campaigner ${seed.displayName}`);
    campaignerIdByName.set(seed.displayName, created.id);
  }
  console.log(`Seeded ${CAMPAIGNER_SEED_DATA.length} campaigners.`);

  const categoryIdBySlug = new Map(
    (await db.select().from(campaignCategories)).map((c) => [c.slug, c.id]),
  );

  let campaignsSeeded = 0;
  for (const seed of CAMPAIGN_SEED_DATA) {
    const categoryId = categoryIdBySlug.get(seed.categorySlug);
    const campaignerId = campaignerIdByName.get(seed.campaignerName);
    if (!categoryId) throw new Error(`unknown category slug in seed data: ${seed.categorySlug}`);
    if (!campaignerId)
      throw new Error(`unknown campaigner name in seed data: ${seed.campaignerName}`);

    await db
      .insert(campaigns)
      .values({
        slug: seed.slug,
        title: seed.title,
        shortDescription: seed.shortDescription,
        story: seed.story,
        coverMediaUrl: seed.coverMediaUrl,
        categoryId,
        campaignerId,
        model: seed.model,
        goalAmount: seed.goalAmount,
        expiresAt: seed.expiresAt,
        collectedAmount: seed.collectedAmount,
        disbursedAmount: seed.disbursedAmount,
        donationCount: seed.donationCount,
        status: "active",
        publishedAt: new Date(),
      })
      .onConflictDoNothing({ target: campaigns.slug });
    campaignsSeeded++;
  }
  console.log(`Seeded ${campaignsSeeded} campaigns.`);
}

if (import.meta.main) {
  await runSeed();
  process.exit(0);
}

export { runSeed };
