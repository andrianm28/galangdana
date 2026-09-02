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
  // Explicitly type categories to match API response schema
  const categories: Array<{ id: number; slug: string; title: string }> = data?.categories ?? [];
  return { categories };
};
