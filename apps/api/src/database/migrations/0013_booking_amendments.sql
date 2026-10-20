CREATE TABLE `booking_amendments` (
	`id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`reason` varchar(500) NOT NULL,
	`summary` text NOT NULL,
	`actor_user_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `booking_amendments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billing_adjustments` (
	`id` varchar(36) NOT NULL,
	`side` enum('CLIENT','CAREGIVER') NOT NULL,
	`patient_id` varchar(36),
	`caregiver_id` varchar(36),
	`booking_id` varchar(36) NOT NULL,
	`amendment_id` varchar(36),
	`source_label` varchar(40),
	`description` varchar(300) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` enum('OPEN','SETTLED','CANCELLED') NOT NULL DEFAULT 'OPEN',
	`closed_note` varchar(500),
	`closed_at` datetime,
	`closed_by_user_id` varchar(36),
	`created_by_user_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `billing_adjustments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `booking_events` MODIFY COLUMN `type` enum('CREATED','UPDATED','REGENERATED','RESCHEDULED','CONFIRMED','EXTENDED','SHIFT_ADDED','SHIFT_CHANGED','SHIFT_REMOVED','NOTE','COMPLETED','CANCELLED','AMENDED') NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `adjustment_id` varchar(36);--> statement-breakpoint
ALTER TABLE `payout_lines` ADD `adjustment_id` varchar(36);--> statement-breakpoint
CREATE INDEX `booking_amendments_booking_idx` ON `booking_amendments` (`booking_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `billing_adjustments_patient_idx` ON `billing_adjustments` (`patient_id`,`status`);--> statement-breakpoint
CREATE INDEX `billing_adjustments_caregiver_idx` ON `billing_adjustments` (`caregiver_id`,`status`);--> statement-breakpoint
CREATE INDEX `billing_adjustments_booking_idx` ON `billing_adjustments` (`booking_id`);--> statement-breakpoint
CREATE INDEX `invoice_lines_adjustment_idx` ON `invoice_lines` (`adjustment_id`);--> statement-breakpoint
CREATE INDEX `payout_lines_adjustment_idx` ON `payout_lines` (`adjustment_id`);