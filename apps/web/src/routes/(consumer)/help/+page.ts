import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  try {
    const { data, error: apiError } = await api["help-articles"].get();
    if (apiError || !data) {
      console.error("GET /help-articles failed while loading the help page:", apiError ?? data);
      return { articles: [] };
    }
    return { articles: data.articles };
  } catch (err) {
    console.error("GET /help-articles threw while loading the help page:", err);
    return { articles: [] };
  }
};
