import { createServerApiClient } from "$lib/server-api-client";
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  // Read unconditionally, before the redirect branches -- see this
  // plan's Global Constraint (the uses.url-tracking fix carried forward
  // from Phase 2c's KYC layout).
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { error: apiError } = await client.admin.campaigns.get({ query: {} });
  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError?.status === 403) {
    redirect(303, "/");
  }

  return {};
};
