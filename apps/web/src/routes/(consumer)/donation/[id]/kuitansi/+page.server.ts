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
  // A kuitansi is proof that money arrived. Rendering one for a donation that
  // has not settled would be a forgery the platform itself produced -- so an
  // unpaid donation gets sent back to its status page, where the truth is.
  if (data.status !== "paid") {
    error(404, "Donasi ini belum lunas, jadi kuitansinya belum ada");
  }
  return { donation: data };
};
