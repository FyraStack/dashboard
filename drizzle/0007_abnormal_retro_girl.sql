CREATE TYPE "public"."billing_resource_type" AS ENUM('vm', 'volume');--> statement-breakpoint
CREATE TYPE "public"."billing_sync_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint
CREATE TABLE "billing_meters" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"resource_type" "billing_resource_type" NOT NULL,
	"resource_id" text NOT NULL,
	"feature_id" text NOT NULL,
	"units" numeric NOT NULL,
	"last_metered_at" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"ended_at" bigint
);
--> statement-breakpoint
CREATE TABLE "billing_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"resource_type" "billing_resource_type" NOT NULL,
	"resource_id" text NOT NULL,
	"feature_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	"period_start" bigint NOT NULL,
	"period_end" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"sync_status" "billing_sync_status" DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"synced_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_billing_customers" (
	"project_id" text PRIMARY KEY NOT NULL,
	"autumn_customer_id" text NOT NULL,
	"sync_status" "billing_sync_status" DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"last_synced_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vm_types" ADD COLUMN "autumn_feature_id" text;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "volumes" ADD COLUMN "created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_meters_resource_index" ON "billing_meters" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "billing_meters_active_last_metered_at_index" ON "billing_meters" USING btree ("active","last_metered_at");--> statement-breakpoint
CREATE INDEX "billing_meters_project_active_index" ON "billing_meters" USING btree ("project_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_usage_events_idempotency_key_index" ON "billing_usage_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_usage_events_project_created_at_index" ON "billing_usage_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_usage_events_sync_status_created_at_index" ON "billing_usage_events" USING btree ("sync_status","created_at");--> statement-breakpoint
CREATE INDEX "billing_usage_events_resource_index" ON "billing_usage_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_billing_customers_autumn_customer_id_index" ON "project_billing_customers" USING btree ("autumn_customer_id");