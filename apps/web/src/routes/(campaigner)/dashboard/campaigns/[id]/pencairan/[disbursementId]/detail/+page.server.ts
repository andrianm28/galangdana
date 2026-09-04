import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { DisbursementDetailResponse } from "@galangdana/contracts";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url, params }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  const client = createServerApiClient(sessionToken);
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data, error: apiError } = (await (client.disbursements as any)({
    id: params.disbursementId,
  }).get()) as Treaty.TreatyResponse<{
    200: DisbursementDetailResponse;
    401: { error: string };
    404: { error: string };
  }>;
  if (apiError?.status === 401 || !data) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  return { disbursement: data };
};
