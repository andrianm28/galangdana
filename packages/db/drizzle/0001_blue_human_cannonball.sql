CREATE TYPE "public"."campaign_model" AS ENUM('goal', 'program');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'pending_review', 'needs_revision', 'active', 'paused', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('donation', 'zakat', 'wakaf');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"short_description" text NOT NULL,
	"story" text DEFAULT '' NOT NULL,
	"cover_media_url" text,
	"category_id" integer NOT NULL,
	"type" "campaign_type" DEFAULT 'donation' NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"model" "campaign_model" NOT NULL,
	"goal_amount" bigint,
	"expires_at" timestamp with time zone,
	"collected_amount" bigint DEFAULT 0 NOT NULL,
	"disbursed_amount" bigint DEFAULT 0 NOT NULL,
	"donation_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_slug_unique" UNIQUE("slug"),
	CONSTRAINT "goal_model_requires_goal_amount" CHECK (("campaigns"."model" = 'goal' AND "campaigns"."goal_amount" IS NOT NULL) OR
          ("campaigns"."model" = 'program' AND "campaigns"."goal_amount" IS NULL AND "campaigns"."expires_at" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_category_id_campaign_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."campaign_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
