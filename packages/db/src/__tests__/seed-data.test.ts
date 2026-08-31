import { describe, expect, test } from "bun:test";
import { CAMPAIGNER_SEED_DATA } from "../seed/campaigners.seed";
import { CAMPAIGN_SEED_DATA } from "../seed/campaigns.seed";

describe("seed fixture data", () => {
  test("every campaign references a campaigner that exists in the campaigner seed data", () => {
    const campaignerNames = new Set(CAMPAIGNER_SEED_DATA.map((c) => c.displayName));
    for (const campaign of CAMPAIGN_SEED_DATA) {
      expect(campaignerNames.has(campaign.campaignerName)).toBe(true);
    }
  });

  test("every goal-model campaign has a goalAmount and an expiresAt; every program-model campaign has neither", () => {
    for (const campaign of CAMPAIGN_SEED_DATA) {
      if (campaign.model === "goal") {
        expect(campaign.goalAmount).not.toBeNull();
        expect(campaign.expiresAt).not.toBeNull();
      } else {
        expect(campaign.goalAmount).toBeNull();
        expect(campaign.expiresAt).toBeNull();
      }
    }
  });

  test("at least one campaign of each model exists, spanning at least 4 distinct categories", () => {
    const models = new Set(CAMPAIGN_SEED_DATA.map((c) => c.model));
    const categories = new Set(CAMPAIGN_SEED_DATA.map((c) => c.categorySlug));
    expect(models.has("goal")).toBe(true);
    expect(models.has("program")).toBe(true);
    expect(categories.size).toBeGreaterThanOrEqual(4);
  });

  test("every campaign slug is unique", () => {
    const slugs = CAMPAIGN_SEED_DATA.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
