import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns";

// The 8 field-scoped revision types this plan supports -- the master
// plan's own revision taxonomy minus "penerima" (beneficiary/patient
// info), which has no campaign-scoped home yet; see this plan's
// "Explicitly Out of Scope" section for why. The 6 document-type values
// here reuse the EXACT string values already defined in
// campaign-documents.ts's campaignDocumentTypeEnum (minus "riwayat_medis",
// which isn't in the master plan's revision taxonomy) -- kept as a
// separate enum rather than importing that one directly, since this
// enum also needs the two non-document content fields ("cerita",
// "target_donasi") that campaign_documents has no notion of.
export const campaignRevisionFieldEnum = pgEnum("campaign_revision_field", [
  "cerita",
  "target_donasi",
  "kartu_mahasiswa",
  "kartu_pelajar",
  "tagihan_rumah_sakit",
  "tagihan_institusi_pendidikan",
  "media_sosial",
  "sumber_gambar",
]);

export const campaignRevisionStatusEnum = pgEnum("campaign_revision_status", ["open", "resolved"]);

export const campaignRevisions = pgTable("campaign_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  field: campaignRevisionFieldEnum("field").notNull(),
  note: text("note").notNull(),
  status: campaignRevisionStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type CampaignRevision = typeof campaignRevisions.$inferSelect;
export type NewCampaignRevision = typeof campaignRevisions.$inferInsert;
