CREATE TABLE `booking_issue_reports` (
	`id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`shift_id` varchar(36),
	`reporter_user_id` varchar(36) NOT NULL,
	`reporter_role` enum('CLIENT','CAREGIVER') NOT NULL,
	`caregiver_id` varchar(36),
	`category` enum('TIMES','DID_NOT_HAPPEN','WRONG_CAREGIVER','CHARGE','PAY','OTHER') NOT NULL,
	`message` text NOT NULL,
	`language` enum('en','si','ta') NOT NULL DEFAULT 'en',
	`status` enum('OPEN','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
	`resolution_note` varchar(500),
	`amendment_id` varchar(36),
	`closed_by_user_id` varchar(36),
	`closed_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `booking_issue_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `booking_events` MODIFY COLUMN `type` enum('CREATED','UPDATED','REGENERATED','RESCHEDULED','CONFIRMED','EXTENDED','SHIFT_ADDED','SHIFT_CHANGED','SHIFT_REMOVED','NOTE','COMPLETED','CANCELLED','AMENDED','ISSUE_REPORTED','ISSUE_CLOSED') NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_adjustments` ADD `taxable` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_adjustments` ADD `split_from_id` varchar(36);--> statement-breakpoint
CREATE INDEX `booking_issue_reports_booking_idx` ON `booking_issue_reports` (`booking_id`,`status`);--> statement-breakpoint
CREATE INDEX `booking_issue_reports_reporter_idx` ON `booking_issue_reports` (`reporter_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `booking_issue_reports_status_idx` ON `booking_issue_reports` (`status`,`created_at`);