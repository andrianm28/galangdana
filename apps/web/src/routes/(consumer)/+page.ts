import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  try {
    const { data } = await api.campaigns.get({ query: { sort: "newest", limit: 8 } });
    return { campaigns: data?.campaigns ?? [] };
  } catch {
    return { campaigns: [] };
  }
};
