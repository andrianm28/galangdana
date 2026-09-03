CREATE TYPE "public"."user_role" AS ENUM('campaigner', 'admin');--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'campaigner' NOT NULL;