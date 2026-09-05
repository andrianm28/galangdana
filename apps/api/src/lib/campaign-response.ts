import type { CampaignSummaryResponse } from "@fundforindonesia/contracts";
import type { Campaign, CampaignCategory, Campaigner } from "@fundforindonesia/db";
import { displayAmount } from "@fundforindonesia/db";
import { buildImgproxyUrl } from "@fundforindonesia/media";
import { moneyToJSON } from "@fundforindonesia/money";

export interface CampaignRow {
  campaign: Campaign;
  category: CampaignCategory;
  campaigner: Campaigner;
}

function imgproxyConfig() {
  return {
    key: process.env.IMGPROXY_KEY ?? "",
    salt: process.env.IMGPROXY_SALT ?? "",
    baseUrl: process.env.IMGPROXY_BASE_URL ?? "http://localhost:8090",
    sourceBaseUrl: process.env.MEDIA_SOURCE_BASE_URL ?? "http://localhost:9000/campaign-media",
  };
}

/**
 * Shared by both /campaigns (list) and /campaigns/:slug (detail) --
 * building the imgproxy URL here, once, server-side, is the enforcement
 * point for this plan's Global Constraint that the signing key never
 * reaches apps/web.
 */
export async function toCampaignSummary(row: CampaignRow): Promise<CampaignSummaryResponse> {
  const { campaign, category, campaigner } = row;
  const coverImageUrl = campaign.coverMediaUrl
    ? await buildImgproxyUrl(campaign.coverMediaUrl, {
        ...imgproxyConfig(),
        resize: { width: 800, height: 600 },
      })
    : "";

  return {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    shortDescription: campaign.shortDescription,
    coverImageUrl,
    category: { id: category.id, slug: category.slug, title: category.title },
    campaigner: {
      id: campaigner.id,
      type: campaigner.type,
      displayName: campaigner.displayName,
      avatarUrl: campaigner.avatarUrl,
      verified: campaigner.verifiedAt !== null,
    },
    model: campaign.model,
    goalAmount: campaign.goalAmount
      ? moneyToJSON({ amount: campaign.goalAmount, currency: campaign.currency })
      : null,
    collectedAmount: moneyToJSON({ amount: campaign.collectedAmount, currency: campaign.currency }),
    availableAmount: moneyToJSON(displayAmount(campaign)),
    donationCount: campaign.donationCount,
    expiresAt: campaign.expiresAt?.toISOString() ?? null,
    publishedAt: (campaign.publishedAt ?? campaign.createdAt).toISOString(),
  };
}

export async function toCampaignDetail(row: CampaignRow) {
  const summary = await toCampaignSummary(row);
  return { ...summary, story: row.campaign.story };
}
