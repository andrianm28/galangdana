// Shared shape for campaign summary payloads. Extracted out of CampaignCard so
// CampaignCard and CampaignListCard consume the exact same interface and
// cannot drift apart -- both variants branch on the same `model` field with
// the same nullability rules (a "program" campaign has goalAmount: null and
// expiresAt: null; a "goal" campaign has both).
import type { MoneyJSON } from "@fundforindonesia/money";

export interface CampaignSummaryLike {
  slug: string;
  title: string;
  shortDescription: string;
  coverImageUrl: string | null;
  category: { id: number; slug: string; title: string };
  campaigner: {
    id: string;
    type: "individual" | "yayasan" | "platform";
    displayName: string;
    avatarUrl: string | null;
    verified: boolean;
  };
  model: "goal" | "program";
  goalAmount: MoneyJSON | null;
  collectedAmount: MoneyJSON;
  availableAmount: MoneyJSON;
  donationCount: number;
  expiresAt: string | null;
  publishedAt: string;
}
