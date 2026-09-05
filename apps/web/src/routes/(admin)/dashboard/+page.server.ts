import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { AdminCampaignListItem } from "@fundforindonesia/contracts";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  // Eden infers this route's 200 response by intersecting the `response`
  // TypeBox schema (AdminCampaignListResponseSchema, whose `status` field is
  // `Type.String()`) with the handler's actual structural return type, whose
  // `status` comes from Drizzle's `campaigns.status` column -- a Postgres
  // enum. The intersection collapses `status` to that DB enum's literal
  // union, which then leaks into this route's generated `PageData` (seen in
  // +page.svelte and page.render.test.ts) as a type stricter than the real
  // contract. Narrow cast on the callable, then re-cast the awaited result to
  // the real response shape from @fundforindonesia/contracts, matching the
  // identical fix already used in the KYC layout load
  // (apps/web/src/routes/(campaigner)/kyc/[campaignId]/step/+layout.server.ts)
  // for the same class of Eden inference conflict.
  // biome-ignore lint/suspicious/noExplicitAny: Eden response-type over-narrowing requires casting
  const { data, error: apiError } = (await (client.admin.campaigns as any).get({
    query: {},
  })) as Treaty.TreatyResponse<{
    200: { campaigns: AdminCampaignListItem[] };
    401: { error: string };
    403: { error: string };
  }>;
  if (apiError || !data) {
    error(500, "Gagal memuat antrian moderasi");
  }
  return { campaigns: data.campaigns };
};
