ALTER TABLE "billing_usage_events" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "deleted_at" bigint;