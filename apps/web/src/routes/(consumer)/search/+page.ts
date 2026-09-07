import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return { query: "", results: [] };
  }

  try {
    const { data, error: apiError } = await api.search.get({ query: { q } });

    // Same Eden Treaty error-checking pattern established in
    // campaign/[slug]/+page.ts and explore/[category]/+page.ts. The
    // `"error" in data` arm is load-bearing now that GET /search declares a
    // 404 (it returns one for an unknown OR archived category slug, matching
    // GET /campaigns) -- without it, `data` is the union of the 200 and 404
    // shapes and `data.results` is possibly undefined. Logged (not surfaced
    // as a distinct UI state) so a genuine backend failure doesn't render
    // silently identical to a legitimately empty search result.
    if (apiError || !data || "error" in data) {
      console.error(`GET /search?q=${q} failed while loading the search page:`, apiError ?? data);
      return { query: q, results: [] };
    }

    return { query: q, results: data.results };
  } catch (err) {
    console.error(`GET /search?q=${q} threw while loading the search page:`, err);
    return { query: q, results: [] };
  }
};
