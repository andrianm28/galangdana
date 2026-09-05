import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { AdminSupportTicketListResponse } from "@fundforindonesia/contracts";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  // support_tickets.status is a Postgres enum -- same Eden response-type
  // over-narrowing risk documented in this plan's Global Constraints and
  // established repeatedly in Phase 3 (e.g.
  // apps/web/src/routes/(admin)/dashboard/+page.server.ts). Cast the base
  // callable, then re-cast the awaited result to the real response shape.
  // biome-ignore lint/suspicious/noExplicitAny: Eden response-type over-narrowing requires casting
  const { data, error: apiError } = (await (client.admin["support-tickets"] as any).get({
    query: {},
  })) as Treaty.TreatyResponse<{
    200: AdminSupportTicketListResponse;
    401: { error: string };
    403: { error: string };
  }>;
  if (apiError || !data) {
    error(500, "Gagal memuat antrian tiket bantuan");
  }
  return { tickets: data.tickets };
};
