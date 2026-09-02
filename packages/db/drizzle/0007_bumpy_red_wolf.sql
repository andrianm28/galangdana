CREATE TYPE "public"."campaign_draft_track" AS ENUM('medical', 'non_medical');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"track" "campaign_draft_track" NOT NULL,
	"category_id" integer,
	"current_step" text DEFAULT 'info' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_story_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"question_number" integer NOT NULL,
	"answer_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_story_answers_draft_id_question_number_unique" UNIQUE("draft_id","question_number")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_drafts" ADD CONSTRAINT "campaign_drafts_category_id_campaign_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."campaign_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_story_answers" ADD CONSTRAINT "campaign_story_answers_draft_id_campaign_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."campaign_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
