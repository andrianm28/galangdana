import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return { query: "", results: [] };
  }

  try {
    const { data } = await api.search.get({ query: { q } });
    return { query: q, results: data?.results ?? [] };
  } catch {
    return { query: q, results: [] };
  }
};
