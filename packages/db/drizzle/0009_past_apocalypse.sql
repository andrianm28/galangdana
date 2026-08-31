CREATE TYPE "public"."campaign_document_type" AS ENUM('kartu_mahasiswa', 'kartu_pelajar', 'tagihan_rumah_sakit', 'tagihan_institusi_pendidikan', 'media_sosial', 'sumber_gambar', 'riwayat_medis');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"type" "campaign_document_type" NOT NULL,
	"object_key" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_documents" ADD CONSTRAINT "campaign_documents_draft_id_campaign_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."campaign_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
