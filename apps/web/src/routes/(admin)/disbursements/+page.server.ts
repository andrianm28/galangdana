import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { AdminDisbursementListResponse } from "@galangdana/contracts";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

type DisbursementListResult = Treaty.TreatyResponse<{
  200: AdminDisbursementListResponse;
  401: { error: string };
  403: { error: string };
}>;

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  // Same Eden response-type over-narrowing fix as the admin dashboard load
  // (apps/web/src/routes/(admin)/dashboard/+page.server.ts): disbursementRequests.status
  // and .type are Postgres enum columns, whose literal unions leak into the
  // inferred response type instead of respecting the declared contract's
  // Type.Union(...). Narrow cast on the callable, then re-cast each awaited
  // result to the real response shape from @galangdana/contracts.
  // biome-ignore lint/suspicious/noExplicitAny: Eden response-type over-narrowing requires casting
  const disbursementsClient = client.admin.disbursements as any;
  // Two separate queries, not one: the admin API only ever returns a single
  // status per call (it has no "in" filter), and both statuses need their own
  // action button (Approve/Reject on "requested", Pay on "approved") to be
  // reachable from this one page -- see this plan's Task 15 fix report for
  // why a "requested"-only fetch left approved disbursements unreachable.
  const [requested, approved] = (await Promise.all([
    disbursementsClient.get({ query: { status: "requested" } }),
    disbursementsClient.get({ query: { status: "approved" } }),
  ])) as [DisbursementListResult, DisbursementListResult];
  if (requested.error || !requested.data || approved.error || !approved.data) {
    error(500, "Gagal memuat antrian pencairan");
  }
  return {
    disbursements: [...requested.data.disbursements, ...approved.data.disbursements],
  };
};
