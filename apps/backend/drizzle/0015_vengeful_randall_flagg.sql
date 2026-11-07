CREATE TYPE "public"."ip_family" AS ENUM('ipv4', 'ipv6');--> statement-breakpoint
CREATE TABLE "ipam_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"ipam_prefix_id" text NOT NULL,
	"associated_vm_id" text NOT NULL,
	"family" "ip_family" NOT NULL,
	"address" "inet",
	"prefix" "cidr",
	"prefix_length" integer NOT NULL,
	"mac_address" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipam_prefixes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cidr" "cidr" NOT NULL,
	"family" "ip_family" NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"ipv6_use_transit_address" boolean DEFAULT false NOT NULL,
	"whitelist_start" "inet",
	"whitelist_end" "inet",
	"gateway_address" "inet",
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ipam_allocations" ADD CONSTRAINT "ipam_allocations_ipam_prefix_id_ipam_prefixes_id_fk" FOREIGN KEY ("ipam_prefix_id") REFERENCES "public"."ipam_prefixes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipam_allocations" ADD CONSTRAINT "ipam_allocations_associated_vm_id_vms_id_fk" FOREIGN KEY ("associated_vm_id") REFERENCES "public"."vms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ipam_allocations_ipam_prefix_id_index" ON "ipam_allocations" USING btree ("ipam_prefix_id");--> statement-breakpoint
CREATE INDEX "ipam_allocations_associated_vm_id_index" ON "ipam_allocations" USING btree ("associated_vm_id");--> statement-breakpoint
CREATE INDEX "ipam_allocations_vm_family_index" ON "ipam_allocations" USING btree ("associated_vm_id","family");--> statement-breakpoint
CREATE UNIQUE INDEX "ipam_allocations_address_index" ON "ipam_allocations" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "ipam_allocations_prefix_index" ON "ipam_allocations" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "ipam_prefixes_cidr_index" ON "ipam_prefixes" USING btree ("cidr");--> statement-breakpoint
CREATE INDEX "ipam_prefixes_family_disabled_index" ON "ipam_prefixes" USING btree ("family","disabled");