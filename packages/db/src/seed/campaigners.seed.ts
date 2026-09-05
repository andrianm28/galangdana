import type { NewCampaigner } from "../schema/campaigners";

export const CAMPAIGNER_SEED_DATA: NewCampaigner[] = [
  { type: "individual", displayName: "Budi Santoso" },
  { type: "individual", displayName: "Rina Wijaya" },
  { type: "yayasan", displayName: "Yayasan Peduli Sesama" },
  { type: "yayasan", displayName: "Yayasan Bina Umat Sejahtera" },
  // Zakat is collected by a licensed amil (BAZNAS or a LAZ), not by a
  // platform. This fixture exists so the zakat campaign has a campaigner that
  // is a partner institution rather than FundForIndonesia itself -- see the
  // note on the zakat fixture in campaigns.seed.ts.
  { type: "yayasan", displayName: "Yayasan Amanah Ummah" },
  { type: "platform", displayName: "FundForIndonesia Program Mitra" },
];
