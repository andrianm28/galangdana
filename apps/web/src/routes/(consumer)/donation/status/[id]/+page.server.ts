import { createServerApiClient } from "$lib/server-api-client";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionToken = cookies.get("session");
  const client = createServerApiClient(sessionToken);
  const { data, error: apiError } = await client.donations({ id: params.id }).get();
  if (apiError || !data) {
    error(404, "Donasi tidak ditemukan");
  }
  return { donation: data };
};
