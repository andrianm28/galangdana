import { createServerApiClient } from "$lib/server-api-client";
import { error, redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, cookies, url }) => {
  // Read unconditionally, before the two redirect(...) branches, so
  // SvelteKit's dependency tracker registers `uses.url` and re-runs this
  // load on every same-page step navigation -- carries forward the fix
  // discovered in Phase 2a's final review; see this plan's Global
  // Constraint. Reused below instead of re-reading url.pathname.
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  // Eden Treaty merges every /campaigns/:X route definition sharing this path
  // depth into one combined callable signature. This position now has BOTH
  // ":id"-named routes (PUT kyc/identity, PUT kyc/contact, POST
  // kyc/documents/presign, POST kyc/documents/confirm, POST submit) and
  // ":slug"-named routes (GET /campaigns/:slug and, per Task 8, GET
  // /campaigns/:slug/kyc -- registered as ":slug" only so memoirist's router
  // accepts a second GET at this trie position; the value is actually a
  // campaign id, not a slug), which forces the inferred param type to
  // require BOTH `id` and `slug` together even though this call only ever
  // needs one. At runtime Eden's proxy reads only the first value of this
  // object (see @elysiajs/eden's treaty implementation) -- the key name
  // itself is never inspected -- so which key we use here is immaterial to
  // behavior. Narrow cast on the callable to route around the unresolvable
  // overload, matching the identical fix already used in
  // apps/web/src/routes/(consumer)/campaign/[slug]/+page.ts and
  // apps/web/src/routes/(campaigner)/create/select-category/+page.svelte for
  // the same class of Eden route-merging conflict.
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data: kyc, error: apiError } = await (client.campaigns as any)({
    id: params.campaignId,
  }).kyc.get();

  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError?.status === 404 || !kyc || "error" in kyc) {
    error(404, "Campaign tidak ditemukan");
  }

  return { kyc };
};
