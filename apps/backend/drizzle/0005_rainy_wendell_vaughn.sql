CREATE INDEX "ip_assignments_ip_block_id_index" ON "ip_assignments" USING btree ("ip_block_id");--> statement-breakpoint
CREATE INDEX "ip_assignments_associated_vm_id_index" ON "ip_assignments" USING btree ("associated_vm_id");--> statement-breakpoint
CREATE INDEX "payment_periods_vm_id_index" ON "payment_periods" USING btree ("vm_id");--> statement-breakpoint
CREATE INDEX "payment_periods_user_id_index" ON "payment_periods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_owner_user_id_index" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "ssh_keys_user_id_index" ON "ssh_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vms_owner_project_id_index" ON "vms" USING btree ("owner_project_id");--> statement-breakpoint
CREATE INDEX "vms_owner_project_active_index" ON "vms" USING btree ("owner_project_id","active");--> statement-breakpoint
CREATE INDEX "vms_proxmox_id_index" ON "vms" USING btree ("proxmox_id");--> statement-breakpoint
CREATE INDEX "volumes_owner_project_id_index" ON "volumes" USING btree ("owner_project_id");--> statement-breakpoint
CREATE INDEX "volumes_associated_vm_id_index" ON "volumes" USING btree ("associated_vm_id");