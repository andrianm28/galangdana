import { createServerApiClient } from "$lib/server-api-client";
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }

  const client = createServerApiClient(sessionToken);
  const { data } = await client.categories.get();
  return { categories: data?.categories ?? [] };
};
