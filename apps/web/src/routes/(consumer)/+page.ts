import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

// Each feed resolves to its own fallback before Promise.all ever sees it, so
// one endpoint's 404/throw can't take the other two sections down with it --
// Promise.all rejects on the first rejection, so the self-contained-promise
// shape (rather than one shared try/catch around all three calls) is what
// makes the degradation independent.
async function loadCampaignFeed(sort: "urgent" | "newest") {
  try {
    const { data, error: apiError } = await api.campaigns.get({
      query: { sort, limit: 8 },
    });

    // Same Eden Treaty error-checking pattern established in
    // campaign/[slug]/+page.ts and explore/[category]/+page.ts: `apiError`
    // and `data` are correlated at runtime but not for TS's narrowing, and
    // the 404 error schema leaks into `data`'s inferred type through this
    // route's `response: { 200, 404 }` map, so `"error" in data` is what
    // actually narrows. Logged (not surfaced as a distinct UI state) so a
    // genuine backend failure doesn't render silently identical to a
    // legitimately empty campaign feed.
    if (apiError || !data || "error" in data) {
      console.error(
        `GET /campaigns?sort=${sort} failed while loading the homepage:`,
        apiError ?? data,
      );
      return [];
    }

    return data.campaigns;
  } catch (err) {
    console.error(`GET /campaigns?sort=${sort} threw while loading the homepage:`, err);
    return [];
  }
}

async function loadCategories() {
  try {
    const { data, error: apiError } = await api.categories.get();

    // GET /categories declares only a 200 schema (apps/api/src/routes/categories.ts)
    // -- unlike GET /campaigns, there is no 404 response, so there is no
    // `"error" in data` arm to add here: `data` is never a union and that
    // arm would be dead code against a single-member type.
    if (apiError || !data) {
      console.error("GET /categories failed while loading the homepage:", apiError);
      return [];
    }

    const categories: Array<{ id: number; slug: string; title: string }> = data.categories;
    return categories;
  } catch (err) {
    console.error("GET /categories threw while loading the homepage:", err);
    return [];
  }
}

export const load: PageLoad = async () => {
  const [urgentCampaigns, latestCampaigns, categories] = await Promise.all([
    loadCampaignFeed("urgent"),
    loadCampaignFeed("newest"),
    loadCategories(),
  ]);

  return { urgentCampaigns, latestCampaigns, categories };
};
