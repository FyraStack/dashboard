CREATE SEQUENCE "public"."proxmox_vmid_seq" INCREMENT BY 1 MINVALUE 1000 MAXVALUE 999999999 START WITH 1000 CACHE 1;--> statement-breakpoint
SELECT setval('proxmox_vmid_seq', GREATEST(COALESCE((SELECT MAX("proxmox_id") FROM "vms"), 0) + 1, 1000), false);
