CREATE TYPE "public"."credit_purchase_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_campaign_recipient_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "billing_usage_reversals" (
	"source_event_id" text PRIMARY KEY NOT NULL,
	"reversal_event_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_campaign_recipients" (
	"campaign_id" text NOT NULL,
	"email" text NOT NULL,
	"status" "email_campaign_recipient_status" DEFAULT 'pending' NOT NULL,
	"claimed_at" bigint,
	"sent_at" bigint,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"subject" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_create_requests" (
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"project_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_credit_purchases" (
	"purchase_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"credits" integer NOT NULL,
	"payment_url" text,
	"status" "credit_purchase_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "billing_usage_events" ADD COLUMN "sync_claimed_at" bigint;--> statement-breakpoint
ALTER TABLE "ipam_allocations" ADD COLUMN "releasing_at" bigint;--> statement-breakpoint
ALTER TABLE "project_billing_customers" ADD COLUMN "past_due_notified_at" bigint;--> statement-breakpoint
ALTER TABLE "project_billing_customers" ADD COLUMN "suspended_notified_at" bigint;--> statement-breakpoint
ALTER TABLE "project_billing_customers" ADD COLUMN "notify_claimed_at" bigint;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "provisioning_resume_claimed_at" bigint;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "resize_claimed_at" bigint;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deleting_at" bigint;--> statement-breakpoint
ALTER TABLE "billing_usage_reversals" ADD CONSTRAINT "billing_usage_reversals_source_event_id_billing_usage_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."billing_usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_reversals" ADD CONSTRAINT "billing_usage_reversals_reversal_event_id_billing_usage_events_id_fk" FOREIGN KEY ("reversal_event_id") REFERENCES "public"."billing_usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_usage_reversals_reversal_event_id_index" ON "billing_usage_reversals" USING btree ("reversal_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_recipients_campaign_email_index" ON "email_campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "project_create_requests_user_request_unique" ON "project_create_requests" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "project_credit_purchases_project_id_index" ON "project_credit_purchases" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_unique" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ipam_allocations_vm_ipv4_unique" ON "ipam_allocations" USING btree ("associated_vm_id") WHERE "ipam_allocations"."family" = 'ipv4';--> statement-breakpoint
CREATE UNIQUE INDEX "ipam_allocations_vm_ipv6_transit_unique" ON "ipam_allocations" USING btree ("associated_vm_id") WHERE "ipam_allocations"."family" = 'ipv6' and "ipam_allocations"."address" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ipam_allocations_vm_ipv6_prefix_unique" ON "ipam_allocations" USING btree ("associated_vm_id") WHERE "ipam_allocations"."family" = 'ipv6' and "ipam_allocations"."prefix" is not null;--> statement-breakpoint
CREATE INDEX "ipam_allocations_releasing_at_index" ON "ipam_allocations" USING btree ("releasing_at");--> statement-breakpoint
DELETE FROM "ssh_keys" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "user_id", "fingerprint" ORDER BY "id") AS "rank"
		FROM "ssh_keys"
	) "ranked" WHERE "rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_keys_user_fingerprint_unique" ON "ssh_keys" USING btree ("user_id","fingerprint");--> statement-breakpoint
UPDATE "vm_types" SET "name" = "name" || ' (' || "id" || ')' WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "name" ORDER BY "id") AS "rank"
		FROM "vm_types"
	) "ranked" WHERE "rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "vm_types_name_unique" ON "vm_types" USING btree ("name");--> statement-breakpoint
DELETE FROM "member" WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (
			PARTITION BY "organization_id", "user_id"
			ORDER BY ("role" = 'owner') DESC, "created_at", "id"
		) AS "rank"
		FROM "member"
	) "ranked" WHERE "rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_unique" ON "member" USING btree ("organization_id", "user_id");--> statement-breakpoint
UPDATE "invitation" SET "status" = 'canceled' WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (
			PARTITION BY "organization_id", lower("email")
			ORDER BY "created_at" DESC, "id" DESC
		) AS "rank"
		FROM "invitation" WHERE "status" = 'pending'
	) "ranked" WHERE "rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_org_email_unique" ON "invitation" USING btree ("organization_id", lower("email")) WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "ipam_prefixes" ADD CONSTRAINT "ipam_prefixes_no_overlap" EXCLUDE USING gist ("cidr" inet_ops WITH &&);
