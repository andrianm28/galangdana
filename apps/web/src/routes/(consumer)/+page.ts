import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

// Each feed resolves to its own fallback before Promise.all ever sees it, so
// one endpoint's 404/throw can't take the other two sections down with it --
// Promise.all rejects on the first rejection, so the self-contained-promise
// shape (rather than one shared try/catch around all three calls) is what
// makes the degradation independent.
async function loadCampaignFeed(sort: "urgent" | "newest", model?: "goal" | "program") {
  const label = model ? `sort=${sort}&model=${model}` : `sort=${sort}`;
  try {
    // `model` is spread in conditionally rather than passed as
    // `model: model ?? undefined`. Verified against this repo's Eden
    // Treaty/Elysia versions in explore/[category]/+page.ts: an explicit
    // `undefined` property value is serialised as the literal string
    // "undefined" on the wire, which then fails the query schema's
    // enum-literal validation with a 422. Omitting the key entirely is the
    // only form that reaches the server as genuinely absent.
    const { data, error: apiError } = await api.campaigns.get({
      query: { sort, limit: 8, ...(model ? { model } : {}) },
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
      console.error(`GET /campaigns?${label} failed while loading the homepage:`, apiError ?? data);
      return [];
    }

    return data.campaigns;
  } catch (err) {
    console.error(`GET /campaigns?${label} threw while loading the homepage:`, err);
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
  const [urgentCampaigns, latestCampaigns, programCampaigns, categories] = await Promise.all([
    loadCampaignFeed("urgent"),
    loadCampaignFeed("newest"),
    // Ported from kibi-clone's OngoingPrograms ("Program Donasi
    // Berkelanjutan"). Needs the model filter added to GET /campaigns in this
    // same change -- a program has no goal and no deadline, so it cannot be
    // selected out of a mixed feed without the server knowing.
    loadCampaignFeed("newest", "program"),
    loadCategories(),
  ]);

  return { urgentCampaigns, latestCampaigns, programCampaigns, categories };
};
