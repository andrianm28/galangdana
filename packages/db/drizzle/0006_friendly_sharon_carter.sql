CREATE TYPE "public"."campaigner_type" AS ENUM('individual', 'yayasan', 'platform');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "campaigner_type" NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "campaigner_id" uuid NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_campaigner_id_campaigners_id_fk" FOREIGN KEY ("campaigner_id") REFERENCES "public"."campaigners"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
