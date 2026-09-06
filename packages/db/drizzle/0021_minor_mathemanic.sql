ALTER TABLE "notifications_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications_outbox" ADD COLUMN "last_error" text;