CREATE TABLE `email_verification_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `email_verification_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('ADMIN','STAFF','VERIFIER','CAREGIVER') NOT NULL DEFAULT 'STAFF';--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` datetime;--> statement-breakpoint
ALTER TABLE `caregivers` ADD `user_id` varchar(36);--> statement-breakpoint
ALTER TABLE `caregivers` ADD `consent_accepted_at` datetime;--> statement-breakpoint
ALTER TABLE `caregivers` ADD CONSTRAINT `caregivers_user_id_unique` UNIQUE(`user_id`);--> statement-breakpoint
CREATE INDEX `email_verification_tokens_user_idx` ON `email_verification_tokens` (`user_id`);