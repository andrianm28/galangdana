CREATE TYPE "public"."individual_verification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "individual_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"national_id" text NOT NULL,
	"date_of_birth" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"ktp_object_key" text,
	"selfie_object_key" text,
	"consented_at" timestamp with time zone,
	"status" "individual_verification_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "individual_verifications_campaign_id_unique" UNIQUE("campaign_id")
);
--> statement-breakpoint
ALTER TABLE "campaigners" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "individual_verifications" ADD CONSTRAINT "individual_verifications_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigners" ADD CONSTRAINT "campaigners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_draft_id_campaign_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."campaign_drafts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "campaigners" ADD CONSTRAINT "campaigners_user_id_unique" UNIQUE("user_id");