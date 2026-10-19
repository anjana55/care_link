CREATE TABLE `billing_settings` (
	`id` varchar(36) NOT NULL,
	`business_name` varchar(200) NOT NULL DEFAULT 'CareLink',
	`business_address` varchar(500),
	`business_phone` varchar(40),
	`business_email` varchar(255),
	`registration_number` varchar(60),
	`tax_enabled` boolean NOT NULL DEFAULT false,
	`tax_name` varchar(40) NOT NULL DEFAULT 'VAT',
	`tax_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`tax_registration_number` varchar(60),
	`invoice_prefix` varchar(12) NOT NULL DEFAULT 'INV',
	`next_invoice_number` int NOT NULL DEFAULT 1,
	`payment_terms_days` int NOT NULL DEFAULT 7,
	`invoice_footer` text,
	`payhere_enabled` boolean NOT NULL DEFAULT false,
	`payhere_mode` enum('SANDBOX','LIVE') NOT NULL DEFAULT 'SANDBOX',
	`payhere_merchant_id` varchar(40),
	`payhere_merchant_secret_encrypted` text,
	`payhere_notify_base_url` varchar(255),
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `billing_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_events` (
	`id` varchar(36) NOT NULL,
	`invoice_id` varchar(36) NOT NULL,
	`type` enum('CREATED','UPDATED','LINES_CHANGED','ISSUED','SENT','PAYMENT','REFUND','PAYMENT_DELETED','PAID','REOPENED','VOIDED','NOTE') NOT NULL,
	`note` text,
	`actor_user_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invoice_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` varchar(36) NOT NULL,
	`position` int NOT NULL,
	`kind` enum('SHIFT','ITEM','ADJUSTMENT') NOT NULL,
	`description` varchar(300) NOT NULL,
	`service_date` date,
	`quantity` decimal(10,2) NOT NULL,
	`unit` enum('HOUR','DAY','MONTH','ITEM') NOT NULL,
	`unit_price` decimal(12,2) NOT NULL,
	`discount_type` enum('PERCENT','AMOUNT'),
	`discount_value` decimal(12,2),
	`amount` decimal(12,2) NOT NULL,
	`shift_id` varchar(36),
	`booking_id` varchar(36),
	`caregiver_id` varchar(36),
	`period_start` date,
	`period_end` date,
	`invoice_id` varchar(36) NOT NULL,
	`taxable` boolean NOT NULL DEFAULT true,
	CONSTRAINT `invoice_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoice_payments` (
	`id` varchar(36) NOT NULL,
	`invoice_id` varchar(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`method` enum('CASH','BANK_TRANSFER','CHEQUE','CARD','PAYHERE','OTHER') NOT NULL,
	`paid_on` date NOT NULL,
	`reference` varchar(120),
	`note` varchar(500),
	`external_id` varchar(80),
	`recorded_by_user_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `invoice_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_payments_external_unique` UNIQUE(`external_id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` varchar(36) NOT NULL,
	`number` varchar(24),
	`patient_id` varchar(36) NOT NULL,
	`booking_id` varchar(36),
	`status` enum('DRAFT','ISSUED','PAID','VOID') NOT NULL DEFAULT 'DRAFT',
	`basis` enum('COMPLETED','SCHEDULED','MANUAL') NOT NULL,
	`period_start` date,
	`period_end` date,
	`issue_date` date,
	`due_date` date,
	`language` enum('en','si','ta') NOT NULL DEFAULT 'en',
	`bill_to_name` varchar(200) NOT NULL,
	`bill_to_address` varchar(500),
	`bill_to_phone` varchar(40),
	`bill_to_email` varchar(255),
	`seller_snapshot` text,
	`footer` text,
	`discount_type` enum('PERCENT','AMOUNT'),
	`discount_value` decimal(12,2),
	`discount_reason` varchar(200),
	`tax_name` varchar(40),
	`tax_rate` decimal(5,2),
	`subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
	`discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`tax_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total` decimal(12,2) NOT NULL DEFAULT '0.00',
	`amount_paid` decimal(12,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`created_by_user_id` varchar(36),
	`issued_at` datetime,
	`issued_by_user_id` varchar(36),
	`paid_at` datetime,
	`voided_at` datetime,
	`void_reason` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `payhere_checkouts` (
	`id` varchar(36) NOT NULL,
	`invoice_id` varchar(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'LKR',
	`mode` enum('SANDBOX','LIVE') NOT NULL,
	`status` enum('PENDING','SUCCESS','FAILED','CANCELLED','CHARGEDBACK') NOT NULL DEFAULT 'PENDING',
	`payment_id` varchar(64),
	`method` varchar(20),
	`status_message` varchar(255),
	`created_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payhere_checkouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payout_lines` (
	`id` varchar(36) NOT NULL,
	`position` int NOT NULL,
	`kind` enum('SHIFT','ITEM','ADJUSTMENT') NOT NULL,
	`description` varchar(300) NOT NULL,
	`service_date` date,
	`quantity` decimal(10,2) NOT NULL,
	`unit` enum('HOUR','DAY','MONTH','ITEM') NOT NULL,
	`unit_price` decimal(12,2) NOT NULL,
	`discount_type` enum('PERCENT','AMOUNT'),
	`discount_value` decimal(12,2),
	`amount` decimal(12,2) NOT NULL,
	`shift_id` varchar(36),
	`booking_id` varchar(36),
	`caregiver_id` varchar(36),
	`period_start` date,
	`period_end` date,
	`statement_id` varchar(36) NOT NULL,
	CONSTRAINT `payout_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payout_statements` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(16) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`status` enum('DRAFT','APPROVED','PAID','VOID') NOT NULL DEFAULT 'DRAFT',
	`period_start` date NOT NULL,
	`period_end` date NOT NULL,
	`total` decimal(12,2) NOT NULL DEFAULT '0.00',
	`notes` text,
	`paid_on` date,
	`payment_method` enum('CASH','BANK_TRANSFER','CHEQUE','CARD','PAYHERE','OTHER'),
	`payment_reference` varchar(120),
	`created_by_user_id` varchar(36),
	`approved_at` datetime,
	`approved_by_user_id` varchar(36),
	`paid_at` datetime,
	`paid_by_user_id` varchar(36),
	`voided_at` datetime,
	`void_reason` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `payout_statements_id` PRIMARY KEY(`id`),
	CONSTRAINT `payout_statements_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `pay_rate_type` enum('HOURLY','DAILY','MONTHLY');--> statement-breakpoint
ALTER TABLE `bookings` ADD `pay_rate_amount` decimal(10,2);--> statement-breakpoint
CREATE INDEX `invoice_events_invoice_idx` ON `invoice_events` (`invoice_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice_idx` ON `invoice_lines` (`invoice_id`,`position`);--> statement-breakpoint
CREATE INDEX `invoice_lines_shift_idx` ON `invoice_lines` (`shift_id`);--> statement-breakpoint
CREATE INDEX `invoice_lines_booking_idx` ON `invoice_lines` (`booking_id`);--> statement-breakpoint
CREATE INDEX `invoice_payments_invoice_idx` ON `invoice_payments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoices_patient_idx` ON `invoices` (`patient_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_booking_idx` ON `invoices` (`booking_id`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `payhere_checkouts_invoice_idx` ON `payhere_checkouts` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `payout_lines_statement_idx` ON `payout_lines` (`statement_id`,`position`);--> statement-breakpoint
CREATE INDEX `payout_lines_shift_idx` ON `payout_lines` (`shift_id`);--> statement-breakpoint
CREATE INDEX `payout_lines_booking_idx` ON `payout_lines` (`booking_id`);--> statement-breakpoint
CREATE INDEX `payout_statements_caregiver_idx` ON `payout_statements` (`caregiver_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `payout_statements_status_idx` ON `payout_statements` (`status`);