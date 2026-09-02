import { createServerApiClient } from "$lib/server-api-client";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const client = createServerApiClient(cookies.get("session"));
  const { data } = await client.auth.me.get();
  return { phone: data?.user?.phone ?? null };
};
