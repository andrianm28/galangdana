ALTER TABLE "campaign_categories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "campaign_categories" SET "is_active" = false WHERE "id" IN (27,45,48,49);