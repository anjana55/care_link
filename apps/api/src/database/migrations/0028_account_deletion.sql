CREATE TABLE `account_deletion_requests` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` enum('CAREGIVER','PATIENT_GUARDIAN') NOT NULL,
	`caregiver_id` varchar(36),
	`patient_id` varchar(36),
	`status` enum('PENDING','CANCELLED','ERASED') NOT NULL DEFAULT 'PENDING',
	`requested_at` datetime NOT NULL,
	`erase_after` datetime NOT NULL,
	`previous_status` varchar(32),
	`cancelled_at` datetime,
	`cancelled_by_user_id` varchar(36),
	`erased_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `account_deletion_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `account_deletion_requests_due_idx` ON `account_deletion_requests` (`status`,`erase_after`);--> statement-breakpoint
CREATE INDEX `account_deletion_requests_user_idx` ON `account_deletion_requests` (`user_id`);