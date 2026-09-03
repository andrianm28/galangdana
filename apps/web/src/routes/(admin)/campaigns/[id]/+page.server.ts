import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { AdminCampaignDetailResponse } from "@galangdana/contracts";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  // Same Eden response-type over-narrowing fix as the admin dashboard load
  // (apps/web/src/routes/(admin)/dashboard/+page.server.ts): several fields
  // here (status, verification.status, documents[].type, revisions[].field
  // and .status) come from Drizzle enum columns, whose literal unions leak
  // into the inferred response type instead of respecting the declared
  // `Type.String()`/`Type.Union(...)` contract. Narrow cast on the callable,
  // then re-cast the awaited result to the real response shape from
  // @galangdana/contracts.
  // biome-ignore lint/suspicious/noExplicitAny: Eden response-type over-narrowing requires casting
  const detailClient = client.admin.campaigns({ id: params.id }) as any;
  const { data, error: apiError } = (await detailClient.get()) as Treaty.TreatyResponse<{
    200: AdminCampaignDetailResponse;
    401: { error: string };
    403: { error: string };
    404: { error: string };
  }>;
  if (apiError?.status === 404 || !data) {
    error(404, "Campaign tidak ditemukan");
  }
  return { campaign: data };
};
