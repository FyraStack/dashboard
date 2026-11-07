UPDATE "vms" SET "proxmox_id" = NULL WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", row_number() OVER (PARTITION BY "proxmox_id" ORDER BY "created_at" DESC) AS "rank"
		FROM "vms" WHERE "active" AND "proxmox_id" IS NOT NULL
	) "ranked" WHERE "rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "vms_active_proxmox_id_unique" ON "vms" USING btree ("proxmox_id") WHERE "vms"."active";