CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "organization" ("id", "name", "slug", "logo", "created_at", "metadata")
SELECT
	"id",
	"project_name",
	'project-' || "id",
	NULL,
	to_timestamp("creation_date" / 1000.0),
	NULL
FROM "projects";
--> statement-breakpoint
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT
	'owner-' || "id" || '-' || "owner_user_id",
	"id",
	"owner_user_id",
	'owner',
	to_timestamp("creation_date" / 1000.0)
FROM "projects";
--> statement-breakpoint
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT
	'member-' || "project_id" || '-' || "user_id",
	"project_id",
	"user_id",
	"permissions"::text,
	now()
FROM "project_permissions"
WHERE NOT EXISTS (
	SELECT 1 FROM "projects"
	WHERE "projects"."id" = "project_permissions"."project_id"
	AND "projects"."owner_user_id" = "project_permissions"."user_id"
);
--> statement-breakpoint
ALTER TABLE "vms" DROP CONSTRAINT "vms_owner_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "volumes" DROP CONSTRAINT "volumes_owner_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_permissions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "project_permissions" CASCADE;--> statement-breakpoint
DROP TABLE "projects" CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "vms" ADD CONSTRAINT "vms_owner_project_id_organization_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_owner_project_id_organization_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."project_permissions_enum";
