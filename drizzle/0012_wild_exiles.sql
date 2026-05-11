ALTER TABLE "ip_assignments" ADD COLUMN "netbox_ip_address_id" integer;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "netbox_vm_id" integer;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "netbox_vm_interface_id" integer;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "netbox_mac_address_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "ip_assignments_netbox_ip_address_id_index" ON "ip_assignments" USING btree ("netbox_ip_address_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vms_netbox_vm_id_index" ON "vms" USING btree ("netbox_vm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vms_netbox_vm_interface_id_index" ON "vms" USING btree ("netbox_vm_interface_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vms_netbox_mac_address_id_index" ON "vms" USING btree ("netbox_mac_address_id");