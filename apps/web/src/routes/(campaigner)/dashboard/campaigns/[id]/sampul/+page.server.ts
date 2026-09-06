import { createServerApiClient } from "$lib/server-api-client";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies, url }) => {
  const currentPath = url.pathname;
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client.campaigns.mine.get();
  if (apiError?.status === 401) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(currentPath)}`);
  }
  if (apiError || !data) {
    error(500, "Gagal memuat campaign Anda");
  }
  const campaign = (data.campaigns ?? []).find((c) => c.id === params.id);
  if (!campaign) {
    // Own list, so a miss is 404 either way: not owned or not existent.
    error(404, "Campaign tidak ditemukan");
  }
  return { campaignId: campaign.id, title: campaign.title, status: campaign.status };
};
