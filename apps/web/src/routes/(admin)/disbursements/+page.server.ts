import { createServerApiClient } from "$lib/server-api-client";
import type { Treaty } from "@elysiajs/eden";
import type { AdminDisbursementListResponse } from "@galangdana/contracts";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  // Same Eden response-type over-narrowing fix as the admin dashboard load
  // (apps/web/src/routes/(admin)/dashboard/+page.server.ts): disbursementRequests.status
  // and .type are Postgres enum columns, whose literal unions leak into the
  // inferred response type instead of respecting the declared contract's
  // Type.Union(...). Narrow cast on the callable, then re-cast the awaited
  // result to the real response shape from @galangdana/contracts.
  // biome-ignore lint/suspicious/noExplicitAny: Eden response-type over-narrowing requires casting
  const { data, error: apiError } = (await (client.admin.disbursements as any).get({
    query: {},
  })) as Treaty.TreatyResponse<{
    200: AdminDisbursementListResponse;
    401: { error: string };
    403: { error: string };
  }>;
  if (apiError || !data) {
    error(500, "Gagal memuat antrian pencairan");
  }
  return { disbursements: data.disbursements };
};
