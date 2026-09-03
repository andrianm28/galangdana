import { createServerApiClient } from "$lib/server-api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client["help-articles"].get();
  if (apiError || !data) {
    error(500, "Gagal memuat daftar artikel");
  }
  return { articles: data.articles };
};
