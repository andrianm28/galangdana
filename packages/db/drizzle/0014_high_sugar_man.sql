ALTER TABLE "campaign_documents" ALTER COLUMN "draft_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_documents" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_documents" ADD CONSTRAINT "campaign_documents_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "campaign_documents" ADD CONSTRAINT "campaign_documents_exactly_one_owner" CHECK (("campaign_documents"."draft_id" IS NOT NULL AND "campaign_documents"."campaign_id" IS NULL) OR
          ("campaign_documents"."draft_id" IS NULL AND "campaign_documents"."campaign_id" IS NOT NULL));