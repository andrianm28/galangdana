import { createServerApiClient } from "$lib/server-api-client";
import { error, redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }

  const client = createServerApiClient(sessionToken);
  // Bracket notation is required for this kebab-case route prefix -- see
  // this plan's Global Constraint; api.campaignDrafts(...) silently 404s.
  const { data: draft, error: apiError } = await client["campaign-drafts"]({
    id: params.draftId,
  }).get();

  // See apps/web/src/routes/(consumer)/campaign/[slug]/+page.ts for why the
  // `"error" in draft` check is required: this route's `response: { 200, 401,
  // 404 }` map leaks the error schema into Eden's inferred `data` type, and
  // `apiError` is a separate binding that does not narrow `draft` on its own.
  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
  if (apiError?.status === 404 || !draft || "error" in draft) {
    error(404, "Draft tidak ditemukan");
  }

  return { draft };
};
