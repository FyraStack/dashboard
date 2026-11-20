CREATE TYPE "public"."support_ticket_category" AS ENUM('technical', 'billing', 'account', 'abuse', 'other');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('open', 'pending', 'closed');--> statement-breakpoint
CREATE SEQUENCE "public"."support_ticket_number_seq" INCREMENT BY 1 MINVALUE 1001 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "support_ticket_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"uploader_user_id" text,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_user_id" text,
	"staff" boolean NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer DEFAULT nextval('support_ticket_number_seq') NOT NULL,
	"subject" text NOT NULL,
	"category" "support_ticket_category" NOT NULL,
	"status" "support_ticket_status" NOT NULL,
	"priority" "support_ticket_priority" DEFAULT 'normal' NOT NULL,
	"project_id" text,
	"vm_id" text,
	"requester_user_id" text,
	"assignee_user_id" text,
	"opened_by_staff" boolean NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"closed_at" bigint,
	"purge_at" bigint
);
--> statement-breakpoint
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_message_id_support_ticket_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."support_ticket_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_uploader_user_id_user_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_vm_id_vms_id_fk" FOREIGN KEY ("vm_id") REFERENCES "public"."vms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_ticket_attachments_message_id_index" ON "support_ticket_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "support_ticket_attachments_uploader_created_index" ON "support_ticket_attachments" USING btree ("uploader_user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_ticket_messages_ticket_created_index" ON "support_ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_ticket_messages_author_created_index" ON "support_ticket_messages" USING btree ("author_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_number_uidx" ON "support_tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "support_tickets_project_id_index" ON "support_tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "support_tickets_requester_user_id_index" ON "support_tickets" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_updated_at_index" ON "support_tickets" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "support_tickets_purge_at_index" ON "support_tickets" USING btree ("purge_at");