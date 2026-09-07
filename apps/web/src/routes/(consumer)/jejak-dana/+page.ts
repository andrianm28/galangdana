import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  try {
    const { data, error: apiError } = await api.disbursements.public.get({ query: {} });

    // Same Eden Treaty error-checking pattern established in
    // campaign/[slug]/+page.ts and search/+page.ts: GET /disbursements/public
    // declares only a 200 response schema, so `data` is never typed with an
    // `{ error }` shape and `apiError`/`!data` is what actually narrows.
    // Logged (not surfaced as a distinct UI state) so a genuine backend
    // failure doesn't render silently identical to a legitimately empty
    // feed -- which, per this page's own empty state, is the normal state
    // today: disbursement_requests has no paid rows yet.
    if (apiError || !data) {
      console.error(
        "GET /disbursements/public failed while loading the jejak dana page:",
        apiError ?? data,
      );
      return { disbursements: [] };
    }

    return { disbursements: data.disbursements };
  } catch (err) {
    console.error("GET /disbursements/public threw while loading the jejak dana page:", err);
    return { disbursements: [] };
  }
};
