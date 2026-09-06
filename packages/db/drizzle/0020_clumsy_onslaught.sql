CREATE TYPE "public"."donation_contact_channel" AS ENUM('email', 'whatsapp');--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "contact_channel" "donation_contact_channel";--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "contact_value" text;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "display_name" text;