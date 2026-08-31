import { api } from "$lib/api-client";
import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

const CAMPAIGNER_TYPES = ["individual", "yayasan", "platform"] as const;
type CampaignerType = (typeof CAMPAIGNER_TYPES)[number];

function parseCampaignerType(value: string | null): CampaignerType | undefined {
  return CAMPAIGNER_TYPES.includes(value as CampaignerType) ? (value as CampaignerType) : undefined;
}

export const load: PageLoad = async ({ params, url }) => {
  const sort = url.searchParams.get("sort") === "urgent" ? "urgent" : "newest";
  const campaignerType = parseCampaignerType(url.searchParams.get("type"));

  // The campaignerType key is spread in conditionally, NOT written as
  // `campaignerType: campaignerType ?? undefined` -- verified empirically
  // against this repo's installed Eden Treaty/Elysia versions that a query
  // object value of `undefined` is NOT the same as an absent key: Eden
  // serializes an explicit `undefined` property value as the literal
  // string "undefined" on the wire, which would then fail
  // CampaignListQuerySchema's enum-literal validation (422) on every
  // explore-page visit that doesn't pick a specific type filter. Omitting
  // the key entirely is the only form that reaches the server as a
  // genuinely absent/undefined value.
  const { data, error: apiError } = await api.campaigns.get({
    query: {
      category: params.category,
      sort,
      limit: 24,
      ...(campaignerType ? { campaignerType } : {}),
    },
  });

  if (apiError?.status === 404) {
    error(404, "Kategori tidak ditemukan");
  }

  return {
    category: params.category,
    sort,
    campaignerType: campaignerType ?? null,
    campaigns: data?.campaigns ?? [],
    totalCount: data?.totalCount ?? 0,
  };
};
