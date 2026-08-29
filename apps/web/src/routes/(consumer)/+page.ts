import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  try {
    const { data, error: apiError } = await api.campaigns.get({
      query: { sort: "newest", limit: 8 },
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
      console.error("GET /campaigns failed while loading the homepage:", apiError ?? data);
      return { campaigns: [] };
    }

    return { campaigns: data.campaigns };
  } catch (err) {
    console.error("GET /campaigns threw while loading the homepage:", err);
    return { campaigns: [] };
  }
};
