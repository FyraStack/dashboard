CREATE TYPE "public"."managed_host_connection_mode" AS ENUM('direct_http', 'websocket', 'vsock_gateway', 'offline');--> statement-breakpoint
CREATE TYPE "public"."managed_host_connection_state" AS ENUM('online', 'offline', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."managed_host_kind" AS ENUM('stack_vps', 'external', 'local');--> statement-breakpoint
CREATE TABLE "managed_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"owner_project_id" text NOT NULL,
	"host_kind" "managed_host_kind" DEFAULT 'external' NOT NULL,
	"linked_vm_id" text,
	"connection_mode" "managed_host_connection_mode" DEFAULT 'direct_http' NOT NULL,
	"connection_state" "managed_host_connection_state" DEFAULT 'unknown' NOT NULL,
	"agent_url" text,
	"bearer_token" text,
	"last_seen_at" bigint,
	"agent_version" text,
	"hostname" text,
	"os" text,
	"arch" text,
	"capabilities" jsonb,
	"last_error" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_hosts" ADD CONSTRAINT "managed_hosts_owner_project_id_organization_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_hosts" ADD CONSTRAINT "managed_hosts_linked_vm_id_vms_id_fk" FOREIGN KEY ("linked_vm_id") REFERENCES "public"."vms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_hosts_owner_project_id_index" ON "managed_hosts" USING btree ("owner_project_id");--> statement-breakpoint
CREATE INDEX "managed_hosts_linked_vm_id_index" ON "managed_hosts" USING btree ("linked_vm_id");--> statement-breakpoint
CREATE INDEX "managed_hosts_connection_state_index" ON "managed_hosts" USING btree ("connection_state");