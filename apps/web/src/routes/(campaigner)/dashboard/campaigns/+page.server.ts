import { createServerApiClient } from "$lib/server-api-client";
import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
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
  if (apiError) {
    error(500, "Gagal memuat campaign Anda");
  }

  return { campaigns: data?.campaigns ?? [] };
};
