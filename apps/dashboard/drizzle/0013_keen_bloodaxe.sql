ALTER TABLE "vms" ADD COLUMN "netbox_primary_ipv4_id" integer;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "netbox_primary_ipv6_id" integer;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "netbox_ipv6_prefix_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "vms_netbox_primary_ipv4_id_index" ON "vms" USING btree ("netbox_primary_ipv4_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vms_netbox_primary_ipv6_id_index" ON "vms" USING btree ("netbox_primary_ipv6_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vms_netbox_ipv6_prefix_id_index" ON "vms" USING btree ("netbox_ipv6_prefix_id");