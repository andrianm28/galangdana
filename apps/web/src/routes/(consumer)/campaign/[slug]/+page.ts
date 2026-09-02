import { api } from "$lib/api-client";
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
  // Eden Treaty merges every /campaigns/:X route definition sharing this path
  // depth into one combined callable signature. Phase 2c added
  // PUT /campaigns/:id/kyc/identity and /contact (param name "id"), which now
  // forces this pre-existing GET /campaigns/:slug call's inferred params type
  // to require BOTH `id` and `slug` together, even though this call only ever
  // needs `slug`. Narrow cast on the callable to route around the
  // unresolvable overload, matching the identical fix already used in
  // apps/web/src/routes/(campaigner)/create/select-category/+page.svelte for
  // the same class of Eden route-merging conflict.
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data, error: apiError } = await (api.campaigns as any)({ slug: params.slug }).get();

  // The plain `!data` falsy check narrows out `null`, but Eden Treaty's
  // inferred type for `data` here is `CampaignDetailResponse | { error:
  // string } | null` (the 404 error schema leaks into the 200 response's
  // inferred type through this route's `response: { 200, 404 }` map), and
  // `apiError` is a SEPARATE destructured binding, so checking it does
  // NOT narrow `data`'s type even though the two are correlated at
  // runtime. The `"error" in data` check discriminates on a property
  // CampaignDetailResponse never has, which TypeScript's control-flow
  // analysis DOES use to narrow a union -- verified empirically against
  // this repo's installed Eden/Elysia versions while writing this page
  // (bun run typecheck failed with "Property 'collectedAmount' does not
  // exist on type '... | { error: string }'" without it).
  if (apiError?.status === 404 || !data || "error" in data) {
    error(404, "Campaign tidak ditemukan");
  }

  return { campaign: data };
};
