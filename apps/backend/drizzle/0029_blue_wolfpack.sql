CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE VIEW "analytics"."api_tokens" AS (select "id", "user_id", "created_at" from "api_tokens");--> statement-breakpoint
CREATE VIEW "analytics"."base_images" AS (select "id", "file_path", "name", "version", "description", "short_name", "icon", "color", "is_official", "logo_svg", "accent_color", "image_type", "secure_boot", "isa", "sort_order" from "base_images");--> statement-breakpoint
CREATE VIEW "analytics"."billing_meters" AS (select "id", "project_id", "resource_type", "resource_id", "feature_id", "units", "last_metered_at", "active", "created_at", "ended_at" from "billing_meters");--> statement-breakpoint
CREATE VIEW "analytics"."billing_usage_events" AS (select "id", "project_id", "resource_type", "resource_id", "feature_id", "quantity", "period_start", "period_end", "idempotency_key", "sync_status", "sync_error", "synced_at", "created_at" from "billing_usage_events");--> statement-breakpoint
CREATE VIEW "analytics"."ipam_allocations" AS (select "id", "ipam_prefix_id", "associated_vm_id", "family", "address", "prefix", "prefix_length", "created_at" from "ipam_allocations");--> statement-breakpoint
CREATE VIEW "analytics"."ipam_prefixes" AS (select "id", "name", "cidr", "family", "disabled", "ipv6_use_transit_address", "whitelist_start", "whitelist_end", "gateway_address", "created_at" from "ipam_prefixes");--> statement-breakpoint
CREATE VIEW "analytics"."ipam_ptr_records" AS (select "id", "ipam_allocation_id", "address", "value", "created_at" from "ipam_ptr_records");--> statement-breakpoint
CREATE VIEW "analytics"."ipam_settings" AS (select "id", "default_ptr_format_ipv4", "default_ptr_format_ipv6" from "ipam_settings");--> statement-breakpoint
CREATE VIEW "analytics"."member" AS (select "id", "organization_id", "user_id", "role", "created_at" from "member");--> statement-breakpoint
CREATE VIEW "analytics"."organization" AS (select "id", "name", "slug", "created_at", "billing_exempt", "disabled", "deleted_at" from "organization");--> statement-breakpoint
CREATE VIEW "analytics"."project_billing_customers" AS (select "project_id", "sync_status", "sync_error", "last_synced_at", "past_due_since", "suspended_at", "created_at", "updated_at" from "project_billing_customers");--> statement-breakpoint
CREATE VIEW "analytics"."ssh_keys" AS (select "id", "user_id", "fingerprint" from "ssh_keys");--> statement-breakpoint
CREATE VIEW "analytics"."user" AS (select "id", "email_verified", "created_at", "updated_at", "role", "banned", "ban_expires", "two_factor_enabled", "is_admin", "billing_exempt" from "user");--> statement-breakpoint
CREATE VIEW "analytics"."vm_types" AS (select "id", "name", "isa", "cores", "ram_capacity", "storage_amount", "rate", "cap", "sort_order" from "vm_types");--> statement-breakpoint
CREATE VIEW "analytics"."vms" AS (select "id", "proxmox_id", "proxmox_node", "last_known_ipv4", "last_known_ipv6", "last_known_status", "last_known_uptime", "last_known_at", "active", "deleted_at", "owner_project_id", "vm_type_id", "creation_date", "created_at", "backend", "status", "status_error" from "vms");--> statement-breakpoint
CREATE VIEW "analytics"."volumes" AS (select "id", "size", "owner_project_id", "associated_vm_id", "created_at" from "volumes");