CREATE TYPE "public"."campaign_revision_field" AS ENUM('cerita', 'target_donasi', 'kartu_mahasiswa', 'kartu_pelajar', 'tagihan_rumah_sakit', 'tagihan_institusi_pendidikan', 'media_sosial', 'sumber_gambar');--> statement-breakpoint
CREATE TYPE "public"."campaign_revision_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"field" "campaign_revision_field" NOT NULL,
	"note" text NOT NULL,
	"status" "campaign_revision_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_revisions" ADD CONSTRAINT "campaign_revisions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
