CREATE TYPE "public"."campaign_currency" AS ENUM('IDR', 'USD');--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "currency" "campaign_currency" DEFAULT 'IDR' NOT NULL;