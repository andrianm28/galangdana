export { getMeilisearchClient } from "./client";
export {
  CAMPAIGNS_INDEX_NAME,
  searchCampaigns,
  pruneCampaignsIndex,
  syncCampaignsIndex,
} from "./campaigns-index";
export type { CampaignSearchDocument, SearchCampaignsOptions } from "./campaigns-index";
