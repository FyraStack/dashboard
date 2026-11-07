DROP INDEX "ip_assignments_netbox_ip_address_id_index";--> statement-breakpoint
DROP INDEX "vms_netbox_vm_id_index";--> statement-breakpoint
DROP INDEX "vms_netbox_vm_interface_id_index";--> statement-breakpoint
DROP INDEX "vms_netbox_mac_address_id_index";--> statement-breakpoint
DROP INDEX "vms_netbox_primary_ipv4_id_index";--> statement-breakpoint
DROP INDEX "vms_netbox_primary_ipv6_id_index";--> statement-breakpoint
DROP INDEX "vms_netbox_ipv6_prefix_id_index";--> statement-breakpoint
ALTER TABLE "ip_assignments" DROP COLUMN "netbox_ip_address_id";--> statement-breakpoint
ALTER TABLE "vms" DROP COLUMN "netbox_vm_id";--> statement-breakpoint
ALTER TABLE "vms" DROP COLUMN "netbox_vm_interface_id";--> statement-breakpoint
ALTER TABLE "vms" DROP COLUMN "netbox_mac_address_id";--> statement-breakpoint
ALTER TABLE "vms" DROP COLUMN "netbox_primary_ipv4_id";--> statement-breakpoint
ALTER TABLE "vms" DROP COLUMN "netbox_primary_ipv6_id";--> statement-breakpoint
ALTER TABLE "vms" DROP COLUMN "netbox_ipv6_prefix_id";