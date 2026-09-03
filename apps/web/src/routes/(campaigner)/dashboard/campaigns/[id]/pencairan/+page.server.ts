import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
  }
};
