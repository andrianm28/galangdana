import { createServerApiClient } from "$lib/server-api-client";
import { error, redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, cookies, url }) => {
  // Read unconditionally, before the two redirect(...) branches below (which
  // don't execute on the happy path) so SvelteKit's dependency tracker
  // registers `uses.url` for this load. Without this, has_changed() never
  // has a reason to re-run the load on a same-page goto() between wizard
  // steps (tujuan -> judul -> target-donasi all resolve to this same
  // layout), so every step after the first silently serves a stale `draft`
  // snapshot from whenever the layout first loaded -- see this task's Bug 2
  // writeup for the back-navigation data-loss this caused. Reused below in
  // both redirect calls instead of re-reading `url.pathname`.
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
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
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError?.status === 404 || !draft || "error" in draft) {
    error(404, "Draft tidak ditemukan");
  }

  return { draft };
};
