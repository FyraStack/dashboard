ALTER TYPE "public"."billing_sync_status" ADD VALUE 'abandoned';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deleted_at" bigint;