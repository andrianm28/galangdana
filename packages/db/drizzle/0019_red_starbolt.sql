ALTER TABLE "disbursement_requests" ADD COLUMN "paid_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disbursement_requests" ADD CONSTRAINT "disbursement_requests_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
