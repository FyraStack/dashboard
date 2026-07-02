ALTER TABLE "vms" ADD COLUMN "last_known_ipv4" "inet";--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "last_known_ipv6" "inet";--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "last_known_status" text;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "last_known_uptime" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "last_known_at" bigint;