ALTER TABLE "base_images" ADD COLUMN "is_official" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "logo_svg" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "accent_color" text DEFAULT '#6b7280' NOT NULL;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "image_type" text DEFAULT 'qcow2' NOT NULL;