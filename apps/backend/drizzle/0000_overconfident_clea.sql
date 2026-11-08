CREATE TYPE "public"."project_permissions_enum" AS ENUM('admin', 'read_write', 'read');--> statement-breakpoint
CREATE TYPE "public"."vm_backend" AS ENUM('proxmox');--> statement-breakpoint
CREATE TYPE "public"."vm_isa" AS ENUM('x86', 'arm', 'risc-v');--> statement-breakpoint
CREATE TABLE "base_images" (
	"id" text PRIMARY KEY NOT NULL,
	"file_path" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"description" text NOT NULL,
	"isa" "vm_isa" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_assignments" (
	"ip" "inet" NOT NULL,
	"ip_block_id" text NOT NULL,
	"associated_vm_id" text
);
--> statement-breakpoint
CREATE TABLE "ip_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"ip_block" "cidr" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"vm_id" text NOT NULL,
	"user_id" text NOT NULL,
	"start_date" integer NOT NULL,
	"end_date" integer,
	"rate" numeric NOT NULL,
	"cap" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_permissions" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permissions" "project_permissions_enum" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"creation_date" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"public_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "vm_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"isa" "vm_isa" NOT NULL,
	"cores" integer NOT NULL,
	"ram_capacity" integer NOT NULL,
	"storage_amount" integer NOT NULL,
	"rate" numeric NOT NULL,
	"cap" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vms" (
	"id" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"owner_project_id" text,
	"vm_type_id" text NOT NULL,
	"creation_date" date NOT NULL,
	"backend" "vm_backend" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volumes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"owner_project_id" text NOT NULL,
	"associated_vm_id" text
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ip_assignments" ADD CONSTRAINT "ip_assignments_ip_block_id_ip_blocks_id_fk" FOREIGN KEY ("ip_block_id") REFERENCES "public"."ip_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_assignments" ADD CONSTRAINT "ip_assignments_associated_vm_id_vms_id_fk" FOREIGN KEY ("associated_vm_id") REFERENCES "public"."vms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_periods" ADD CONSTRAINT "payment_periods_vm_id_vms_id_fk" FOREIGN KEY ("vm_id") REFERENCES "public"."vms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_permissions" ADD CONSTRAINT "project_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vms" ADD CONSTRAINT "vms_owner_project_id_projects_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vms" ADD CONSTRAINT "vms_vm_type_id_vm_types_id_fk" FOREIGN KEY ("vm_type_id") REFERENCES "public"."vm_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_owner_project_id_projects_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volumes" ADD CONSTRAINT "volumes_associated_vm_id_vms_id_fk" FOREIGN KEY ("associated_vm_id") REFERENCES "public"."vms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_user_permissions_index" ON "project_permissions" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");