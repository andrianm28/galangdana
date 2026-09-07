import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  const { data, error: apiError } = await api.categories.get();

  // GET /categories declares only a 200 schema (apps/api/src/routes/categories.ts)
  // -- unlike GET /campaigns and GET /search, there is no 404 response, so
  // there is no `"error" in data` arm to add here: `data` is never a union
  // and that arm would be dead code against a single-member type.
  if (apiError || !data) {
    console.error("GET /categories failed while loading the explore index page:", apiError);
    return { categories: [] };
  }

  // Eden infers this from the handler's actual `db.select()` return type
  // (the full campaignCategories row), not from the narrower 200 response
  // schema -- same quirk worked around in
  // (campaigner)/create/select-category/+page.server.ts. Explicitly typed
  // here to match CampaignCategorySchema instead of leaking DB columns
  // (createdAt, isFavorite, isActive) into page data.
  const categories: Array<{ id: number; slug: string; title: string }> = data.categories;
  return { categories };
};
