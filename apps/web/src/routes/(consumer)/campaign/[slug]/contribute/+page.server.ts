import { api } from "$lib/api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  // biome-ignore lint/suspicious/noExplicitAny: Eden route-merging conflict requires narrowing
  const { data, error: apiError } = await (api.campaigns as any)({ slug: params.slug }).get();
  if (apiError?.status === 404 || !data || "error" in data) {
    error(404, "Campaign tidak ditemukan");
  }
  return { campaign: data };
};
