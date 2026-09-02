import { sql } from "drizzle-orm";
import { check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaignDrafts } from "./campaign-drafts";
import { campaigns } from "./campaigns";

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
export const campaignDocuments = pgTable(
  "campaign_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable as of this plan (Phase 3) -- was NOT NULL through Phase 2a.
    // A document row now belongs to EITHER a draft (the original upload,
    // Phase 2a's flow, unchanged) OR a campaign (a revision re-upload,
    // this plan's new flow) -- never both, never neither, enforced below.
    draftId: uuid("draft_id").references(() => campaignDrafts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    type: campaignDocumentTypeEnum("type").notNull(),
    objectKey: text("object_key").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "campaign_documents_exactly_one_owner",
      sql`(${table.draftId} IS NOT NULL AND ${table.campaignId} IS NULL) OR
          (${table.draftId} IS NULL AND ${table.campaignId} IS NOT NULL)`,
    ),
  ],
);

export type CampaignDocument = typeof campaignDocuments.$inferSelect;
export type NewCampaignDocument = typeof campaignDocuments.$inferInsert;
