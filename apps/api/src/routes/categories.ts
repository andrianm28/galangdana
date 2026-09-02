import { CampaignCategorySchema } from "@galangdana/contracts";
import { campaignCategories, db } from "@galangdana/db";
import { Elysia, t } from "elysia";

export const categoriesRoute = new Elysia().get(
  "/categories",
  async () => {
    const categories = await db.select().from(campaignCategories);
    return { categories };
  },
  { response: { 200: t.Object({ categories: t.Array(CampaignCategorySchema) }) } },
);
