CREATE TABLE `patients` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`phone` varchar(20),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `patients_id` PRIMARY KEY(`id`),
	CONSTRAINT `patients_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('ADMIN','STAFF','VERIFIER','CAREGIVER','PATIENT_GUARDIAN') NOT NULL DEFAULT 'STAFF';--> statement-breakpoint
ALTER TABLE `caregivers` ADD `public_id` varchar(36);--> statement-breakpoint
ALTER TABLE `caregivers` ADD CONSTRAINT `caregivers_public_id_unique` UNIQUE(`public_id`);--> statement-breakpoint
CREATE INDEX `patients_user_idx` ON `patients` (`user_id`);--> statement-breakpoint
CREATE INDEX `caregivers_public_id_idx` ON `caregivers` (`public_id`);--> statement-breakpoint
CREATE INDEX `caregivers_public_search_idx` ON `caregivers` (`status`,`district`,`city`);