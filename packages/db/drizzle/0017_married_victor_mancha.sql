CREATE TYPE "public"."disbursement_status" AS ENUM('draft', 'otp_pending', 'requested', 'approved', 'rejected', 'processing', 'paid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."disbursement_type" AS ENUM('partial', 'final');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'disbursement');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaigner_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disbursement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"bank_account_id" uuid,
	"type" "disbursement_type",
	"amount" bigint,
	"currency" "campaign_currency",
	"narrative" text,
	"proof_object_key" text,
	"status" "disbursement_status" DEFAULT 'draft' NOT NULL,
	"otp_verified_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"payout_ref" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "otp_challenges_phone_created_at_idx";--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "purpose" "otp_purpose" DEFAULT 'login' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_campaigner_id_campaigners_id_fk" FOREIGN KEY ("campaigner_id") REFERENCES "public"."campaigners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursement_requests" ADD CONSTRAINT "disbursement_requests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursement_requests" ADD CONSTRAINT "disbursement_requests_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursement_requests" ADD CONSTRAINT "disbursement_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_challenges_phone_purpose_created_at_idx" ON "otp_challenges" USING btree ("phone","purpose","created_at");