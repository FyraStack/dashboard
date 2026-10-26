CREATE TYPE "public"."image_status" AS ENUM('importing', 'ready', 'failed');--> statement-breakpoint
DROP VIEW "analytics"."base_images";--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "owner_project_id" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "status" "image_status" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "status_error" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "virtual_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "import_node" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "import_upid" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "vms" ADD COLUMN "source_image_id" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD CONSTRAINT "base_images_owner_project_id_organization_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "base_images_owner_project_id_index" ON "base_images" USING btree ("owner_project_id");--> statement-breakpoint
CREATE INDEX "base_images_status_updated_at_index" ON "base_images" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "vms_source_image_status_index" ON "vms" USING btree ("source_image_id","status");--> statement-breakpoint
CREATE VIEW "analytics"."base_images" AS (select "id", "file_path", "name", "version", "description", "short_name", "icon", "color", "is_official", "logo_svg", "accent_color", "image_type", "secure_boot", "isa", "sort_order", "owner_project_id", "status", "size_bytes", "virtual_size_bytes", "created_at" from "base_images");