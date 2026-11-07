CREATE TABLE "ipam_ptr_records" (
	"id" text PRIMARY KEY NOT NULL,
	"ipam_allocation_id" text NOT NULL,
	"address" "inet" NOT NULL,
	"value" text NOT NULL,
	"bunny_record_id" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipam_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"default_ptr_format_ipv4" text,
	"default_ptr_format_ipv6" text
);
--> statement-breakpoint
ALTER TABLE "ipam_prefixes" ADD COLUMN "bunny_dns_zone" text;--> statement-breakpoint
ALTER TABLE "ipam_ptr_records" ADD CONSTRAINT "ipam_ptr_records_ipam_allocation_id_ipam_allocations_id_fk" FOREIGN KEY ("ipam_allocation_id") REFERENCES "public"."ipam_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ipam_ptr_records_ipam_allocation_id_index" ON "ipam_ptr_records" USING btree ("ipam_allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ipam_ptr_records_address_index" ON "ipam_ptr_records" USING btree ("address");