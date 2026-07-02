CREATE TYPE "public"."vm_status" AS ENUM('provisioning', 'ready', 'error');--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "status" "vm_status" DEFAULT 'provisioning' NOT NULL;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "status_error" text;--> statement-breakpoint
UPDATE "vms" SET "status" = 'ready' WHERE "active" = true;