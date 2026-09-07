import { CampaignCategorySchema } from "@fundforindonesia/contracts";
import { campaignCategories, db } from "@fundforindonesia/db";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

export const categoriesRoute = new Elysia().get(
  "/categories",
  async () => {
    // Archived categories (isActive: false -- e.g. zakat/wakaf) are kept as
    // FK targets for existing campaigns but must not be offered to donors
    // browsing or creating new campaigns.
    const categories = await db
      .select()
      .from(campaignCategories)
      .where(eq(campaignCategories.isActive, true));
    return { categories };
  },
  { response: { 200: t.Object({ categories: t.Array(CampaignCategorySchema) }) } },
);
