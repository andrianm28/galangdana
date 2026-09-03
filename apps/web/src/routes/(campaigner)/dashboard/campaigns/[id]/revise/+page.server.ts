import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { CampaignRevisionListResponse } from "@galangdana/contracts";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies, url }) => {
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  // GET /campaigns/:id/revisions is internally routed with a ":slug" param
  // name (memoirist requires a consistent GET param name at this trie
  // position -- see apps/api/src/routes/campaigns.ts), which merges into
  // Eden's generated call signature as `{ id, slug }` both required.
  // Narrow cast on the callable, then re-cast the awaited result to the
  // real response shape from @galangdana/contracts (same two-part fix as
  // apps/web/src/routes/(admin)/campaigns/[id]/+page.server.ts).
  // biome-ignore lint/suspicious/noExplicitAny: Eden merged-param-name cast
  const revisionsClient = (client.campaigns as any)({ id: params.id }).revisions;
  const { data, error: apiError } = (await revisionsClient.get()) as Treaty.TreatyResponse<{
    200: CampaignRevisionListResponse;
    401: { error: string };
    404: { error: string };
  }>;
  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError?.status === 404 || !data) {
    error(404, "Campaign tidak ditemukan");
  }

  return {
    campaignId: params.id,
    story: data.story,
    goalAmount: data.goalAmount,
    revisions: data.revisions.filter((r) => r.status === "open"),
  };
};
