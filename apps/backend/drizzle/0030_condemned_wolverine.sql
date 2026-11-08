ALTER TABLE "billing_meters" ADD COLUMN "cap_period_start" bigint;--> statement-breakpoint
ALTER TABLE "billing_meters" ADD COLUMN "cap_period_end" bigint;--> statement-breakpoint
ALTER TABLE "billing_meters" ADD COLUMN "hours_this_period" numeric DEFAULT '0' NOT NULL;