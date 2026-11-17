CREATE TABLE `onboarding_files` (
	`caregiver_id` varchar(36) NOT NULL,
	`recommendation` enum('READY','NOT_READY','CONCERNS') NOT NULL,
	`checks` json NOT NULL,
	`assembled_at` datetime NOT NULL,
	`ready_notified_at` datetime,
	`documents_requested` varchar(60),
	`documents_requested_at` datetime,
	`documents_escalated_at` datetime,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `onboarding_files_caregiver_id` PRIMARY KEY(`caregiver_id`)
);
--> statement-breakpoint
ALTER TABLE `references` ADD `confirm_token_hash` varchar(64);--> statement-breakpoint
ALTER TABLE `references` ADD `confirm_sent_at` datetime;--> statement-breakpoint
ALTER TABLE `references` ADD `confirm_channel` varchar(20);--> statement-breakpoint
ALTER TABLE `references` ADD `confirm_answer` json;--> statement-breakpoint
ALTER TABLE `references` ADD `confirm_answered_at` datetime;--> statement-breakpoint
ALTER TABLE `references` ADD `confirm_escalated_at` datetime;--> statement-breakpoint
ALTER TABLE `references` ADD CONSTRAINT `references_confirm_token_idx` UNIQUE(`confirm_token_hash`);