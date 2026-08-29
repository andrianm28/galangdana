import { api } from "$lib/api-client";
import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
  // Eden Treaty throws (rather than resolving to { data: null, error }) on a
  // connection failure -- e.g. TypeError: Unable to connect. Without this
  // try/catch, an API outage would 500 the whole page instead of degrading
  // gracefully to "unknown".
  try {
    const { data } = await api.healthz.get();
    return {
      apiStatus: data?.status ?? "unknown",
      apiService: data?.service ?? "unknown",
    };
  } catch {
    return { apiStatus: "unknown", apiService: "unknown" };
  }
};
