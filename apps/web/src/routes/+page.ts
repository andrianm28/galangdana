import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  const { data } = await api.healthz.get();
  return {
    apiStatus: data?.status ?? "unknown",
    apiService: data?.service ?? "unknown",
  };
};
