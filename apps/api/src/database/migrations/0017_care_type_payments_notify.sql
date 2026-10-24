CREATE TABLE `bank_accounts` (
	`id` varchar(36) NOT NULL,
	`bank_name` varchar(120) NOT NULL,
	`branch` varchar(120),
	`account_name` varchar(200) NOT NULL,
	`account_number` varchar(40) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bank_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `care_request_events` MODIFY COLUMN `type` enum('CREATED','STATUS_CHANGED','NOTE','ASSIGNED','CANCELLED','CAREGIVER_CHANGED','CAREGIVER_NOTIFIED') NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_payments` MODIFY COLUMN `method` enum('CASH','BANK_TRANSFER','CHEQUE','CARD','PAYHERE','OTHER');--> statement-breakpoint
ALTER TABLE `caregivers` ADD `auto_notify_requests` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `availability` ADD `care_home_shift` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `availability` ADD `care_live_in` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `availability` ADD `care_hospital` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `availability` ADD `care_nursing_home` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `availability` ADD `care_retirement_home` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `care_requests` ADD `care_type` enum('HOME_SHIFT','LIVE_IN','HOSPITAL','NURSING_HOME','RETIREMENT_HOME');--> statement-breakpoint
ALTER TABLE `care_requests` ADD `district_id` int;--> statement-breakpoint
ALTER TABLE `care_requests` ADD `city_id` int;--> statement-breakpoint
ALTER TABLE `care_requests` ADD `desired_start_date` date;--> statement-breakpoint
ALTER TABLE `care_requests` ADD `caregiver_notified_at` datetime;--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `payment_type` enum('CASH','BANK','ONLINE') NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `bank_account_id` varchar(36);--> statement-breakpoint
ALTER TABLE `payout_statements` ADD `payment_type` enum('CASH','BANK','ONLINE');--> statement-breakpoint
ALTER TABLE `payout_statements` ADD `bank_account_id` varchar(36);--> statement-breakpoint
UPDATE `invoice_payments` SET `payment_type` = CASE `method` WHEN 'BANK_TRANSFER' THEN 'BANK' WHEN 'CHEQUE' THEN 'BANK' WHEN 'CARD' THEN 'ONLINE' WHEN 'PAYHERE' THEN 'ONLINE' ELSE 'CASH' END;--> statement-breakpoint
UPDATE `payout_statements` SET `payment_type` = CASE `payment_method` WHEN 'BANK_TRANSFER' THEN 'BANK' WHEN 'CHEQUE' THEN 'BANK' WHEN 'CARD' THEN 'ONLINE' WHEN 'PAYHERE' THEN 'ONLINE' ELSE 'CASH' END WHERE `payment_method` IS NOT NULL;
