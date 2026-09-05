import { CampaignCategorySchema } from "@fundforindonesia/contracts";
import { campaignCategories, db } from "@fundforindonesia/db";
import { Elysia, t } from "elysia";

export const categoriesRoute = new Elysia().get(
  "/categories",
  async () => {
    const categories = await db.select().from(campaignCategories);
    return { categories };
  },
  { response: { 200: t.Object({ categories: t.Array(CampaignCategorySchema) }) } },
);
