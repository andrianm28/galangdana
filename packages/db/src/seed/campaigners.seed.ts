import type { NewCampaigner } from "../schema/campaigners";

export const CAMPAIGNER_SEED_DATA: NewCampaigner[] = [
  { type: "individual", displayName: "Budi Santoso" },
  { type: "individual", displayName: "Rina Wijaya" },
  { type: "yayasan", displayName: "Yayasan Peduli Sesama" },
  { type: "yayasan", displayName: "Yayasan Bina Umat Sejahtera" },
  // Originally created so the platform's zakat fixture had a campaigner that
  // was a partner institution (a licensed amil) rather than FundForIndonesia
  // itself. That campaign was renamed away from zakat when the product cut
  // zakat/wakaf entirely -- see the comment above the "pangan-keluarga-
  // prasejahtera" entry in campaigns.seed.ts -- but this campaigner is kept
  // as-is since it's still that campaign's (unchanged) campaigner.
  { type: "yayasan", displayName: "Yayasan Amanah Ummah" },
  { type: "platform", displayName: "FundForIndonesia Program Mitra" },
];
