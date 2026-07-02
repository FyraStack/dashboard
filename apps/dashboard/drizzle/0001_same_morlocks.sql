ALTER TABLE "base_images" ADD COLUMN "short_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "base_images" ADD COLUMN "color" text DEFAULT 'bg-gray-600' NOT NULL;