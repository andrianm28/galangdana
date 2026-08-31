import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";

// Evidentiary documents ONLY -- deliberately excludes "ktp"/"selfie" (the
// individual-KYC identity documents), which belong to sub-phase 2c and
// upload through a separate flow with stricter handling. Matches the
// master plan's revision taxonomy minus those two entries.
export const campaignDocumentTypeEnum = pgEnum("campaign_document_type", [
  "kartu_mahasiswa",
  "kartu_pelajar",
  "tagihan_rumah_sakit",
  "tagihan_institusi_pendidikan",
  "media_sosial",
  "sumber_gambar",
  "riwayat_medis",
]);

// objectKey points into the PRIVATE `campaign-documents` MinIO bucket
// (never the public `campaign-media` bucket Phase 1 built for cover
// images) -- see this plan's Global Constraint. No anonymous-read policy
// on that bucket; reading a document back requires a presigned GET
// generated server-side after an ownership check (Task 10).
export const campaignDocuments = pgTable("campaign_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id")
    .notNull()
    .references(() => campaignDrafts.id, { onDelete: "cascade" }),
  type: campaignDocumentTypeEnum("type").notNull(),
  objectKey: text("object_key").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignDocument = typeof campaignDocuments.$inferSelect;
export type NewCampaignDocument = typeof campaignDocuments.$inferInsert;
