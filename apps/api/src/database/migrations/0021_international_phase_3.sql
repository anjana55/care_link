CREATE TABLE `document_expiry_reminders` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`subject` varchar(60) NOT NULL,
	`expires_on` date NOT NULL,
	`stage` enum('DAYS_90','DAYS_30','EXPIRED') NOT NULL,
	`sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `document_expiry_reminders_id` PRIMARY KEY(`id`),
	CONSTRAINT `document_expiry_reminders_unique` UNIQUE(`caregiver_id`,`subject`,`expires_on`,`stage`)
);
--> statement-breakpoint
CREATE TABLE `overseas_vacancies` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(16) NOT NULL,
	`enquiry_id` varchar(36) NOT NULL,
	`employer_id` varchar(36),
	`title` varchar(150) NOT NULL,
	`country` varchar(2) NOT NULL,
	`city` varchar(100),
	`care_setting` varchar(40) NOT NULL,
	`roles_count` int NOT NULL,
	`description` text NOT NULL,
	`requirements` text,
	`min_experience_years` int NOT NULL DEFAULT 0,
	`english_level` enum('BASIC','CONVERSATIONAL','FLUENT') NOT NULL DEFAULT 'CONVERSATIONAL',
	`salary_min` decimal(12,2),
	`salary_max` decimal(12,2),
	`salary_currency` varchar(3),
	`salary_period` enum('HOUR','MONTH','YEAR'),
	`contract_months` int,
	`accommodation_provided` boolean,
	`visa_sponsorship` enum('YES','NO','UNSURE') NOT NULL DEFAULT 'UNSURE',
	`start_timeframe` varchar(100),
	`closes_on` date,
	`status` enum('PENDING_REVIEW','PUBLISHED','REJECTED','CLOSED','FILLED') NOT NULL DEFAULT 'PENDING_REVIEW',
	`review_note` varchar(500),
	`reviewed_by_user_id` varchar(36),
	`reviewed_at` datetime,
	`published_at` datetime,
	`created_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `overseas_vacancies_id` PRIMARY KEY(`id`),
	CONSTRAINT `overseas_vacancies_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `placement_checkins` (
	`id` varchar(36) NOT NULL,
	`placement_id` varchar(36) NOT NULL,
	`kind` enum('ARRIVAL','DAY_30','DAY_90','DAY_180') NOT NULL,
	`due_on` date NOT NULL,
	`completed_on` date,
	`outcome` enum('WELL','CONCERN','URGENT'),
	`note` varchar(1000),
	`recorded_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `placement_checkins_id` PRIMARY KEY(`id`),
	CONSTRAINT `placement_checkins_placement_kind_unique` UNIQUE(`placement_id`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `placement_checkouts` (
	`id` varchar(36) NOT NULL,
	`invoice_id` varchar(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`mode` enum('SANDBOX','LIVE') NOT NULL,
	`status` enum('PENDING','SUCCESS','FAILED','CANCELLED','CHARGEDBACK') NOT NULL DEFAULT 'PENDING',
	`payment_id` varchar(64),
	`method` varchar(20),
	`status_message` varchar(255),
	`created_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `placement_checkouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `placement_invoice_counters` (
	`year` int NOT NULL,
	`last_number` int NOT NULL DEFAULT 0,
	CONSTRAINT `placement_invoice_counters_year` PRIMARY KEY(`year`)
);
--> statement-breakpoint
CREATE TABLE `placement_invoice_payments` (
	`id` varchar(36) NOT NULL,
	`invoice_id` varchar(36) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`method` enum('BANK_TRANSFER','CARD_ONLINE','OTHER') NOT NULL,
	`paid_on` date NOT NULL,
	`reference` varchar(120),
	`note` varchar(500),
	`external_id` varchar(80),
	`recorded_by_user_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `placement_invoice_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `placement_invoice_payments_external_id_unique` UNIQUE(`external_id`)
);
--> statement-breakpoint
CREATE TABLE `placement_invoices` (
	`id` varchar(36) NOT NULL,
	`number` varchar(24),
	`enquiry_id` varchar(36) NOT NULL,
	`placement_id` varchar(36),
	`employer_id` varchar(36),
	`status` enum('DRAFT','ISSUED','PAID','VOID') NOT NULL DEFAULT 'DRAFT',
	`currency` varchar(3) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`amount_paid` decimal(12,2) NOT NULL DEFAULT '0.00',
	`description` varchar(300) NOT NULL,
	`bill_to_name` varchar(200) NOT NULL,
	`bill_to_email` varchar(255),
	`bill_to_address` varchar(500),
	`bill_to_country` varchar(2),
	`issue_date` date,
	`due_date` date,
	`seller_snapshot` text,
	`footer` text,
	`notes` text,
	`created_by_user_id` varchar(36),
	`issued_at` datetime,
	`paid_at` datetime,
	`voided_at` datetime,
	`void_reason` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `placement_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `placement_invoices_number_unique` UNIQUE(`number`)
);
--> statement-breakpoint
CREATE TABLE `placements` (
	`id` varchar(36) NOT NULL,
	`candidate_id` varchar(36) NOT NULL,
	`enquiry_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`employer_id` varchar(36),
	`country` varchar(2) NOT NULL,
	`job_title` varchar(150),
	`status` enum('PRE_DEPARTURE','DEPLOYED','COMPLETED','ENDED_EARLY') NOT NULL DEFAULT 'PRE_DEPARTURE',
	`departure_on` date,
	`arrived_on` date,
	`contract_start_on` date,
	`contract_months` int,
	`ended_on` date,
	`end_reason` varchar(500),
	`guarantee_months` int NOT NULL DEFAULT 3,
	`fee_amount` decimal(12,2),
	`fee_currency` varchar(3),
	`staff_note` text,
	`created_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `placements_id` PRIMARY KEY(`id`),
	CONSTRAINT `placements_candidate_id_unique` UNIQUE(`candidate_id`)
);
--> statement-breakpoint
CREATE TABLE `vacancy_applications` (
	`id` varchar(36) NOT NULL,
	`vacancy_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`status` enum('APPLIED','PUT_FORWARD','NOT_SUCCESSFUL','WITHDRAWN') NOT NULL DEFAULT 'APPLIED',
	`message` varchar(1000),
	`candidate_id` varchar(36),
	`staff_note` varchar(1000),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `vacancy_applications_id` PRIMARY KEY(`id`),
	CONSTRAINT `vacancy_applications_vacancy_caregiver_unique` UNIQUE(`vacancy_id`,`caregiver_id`)
);
--> statement-breakpoint
ALTER TABLE `enquiry_candidates` MODIFY COLUMN `source` enum('STAFF','EMPLOYER','APPLICATION') NOT NULL;--> statement-breakpoint
ALTER TABLE `caregiver_documents` ADD `expires_on` date;--> statement-breakpoint
ALTER TABLE `document_expiry_reminders` ADD CONSTRAINT `document_expiry_reminders_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `overseas_vacancies` ADD CONSTRAINT `overseas_vacancies_enquiry_id_employer_enquiries_id_fk` FOREIGN KEY (`enquiry_id`) REFERENCES `employer_enquiries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `overseas_vacancies` ADD CONSTRAINT `overseas_vacancies_employer_id_employers_id_fk` FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placement_checkins` ADD CONSTRAINT `placement_checkins_placement_id_placements_id_fk` FOREIGN KEY (`placement_id`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placement_checkouts` ADD CONSTRAINT `placement_checkouts_invoice_id_placement_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `placement_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placement_invoice_payments` ADD CONSTRAINT `placement_invoice_payments_invoice_id_placement_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `placement_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placement_invoices` ADD CONSTRAINT `placement_invoices_enquiry_id_employer_enquiries_id_fk` FOREIGN KEY (`enquiry_id`) REFERENCES `employer_enquiries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placement_invoices` ADD CONSTRAINT `placement_invoices_placement_id_placements_id_fk` FOREIGN KEY (`placement_id`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placement_invoices` ADD CONSTRAINT `placement_invoices_employer_id_employers_id_fk` FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_candidate_id_enquiry_candidates_id_fk` FOREIGN KEY (`candidate_id`) REFERENCES `enquiry_candidates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_enquiry_id_employer_enquiries_id_fk` FOREIGN KEY (`enquiry_id`) REFERENCES `employer_enquiries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_employer_id_employers_id_fk` FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vacancy_applications` ADD CONSTRAINT `vacancy_applications_vacancy_id_overseas_vacancies_id_fk` FOREIGN KEY (`vacancy_id`) REFERENCES `overseas_vacancies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vacancy_applications` ADD CONSTRAINT `vacancy_applications_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vacancy_applications` ADD CONSTRAINT `vacancy_applications_candidate_id_enquiry_candidates_id_fk` FOREIGN KEY (`candidate_id`) REFERENCES `enquiry_candidates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `overseas_vacancies_status_idx` ON `overseas_vacancies` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `overseas_vacancies_employer_idx` ON `overseas_vacancies` (`employer_id`);--> statement-breakpoint
CREATE INDEX `overseas_vacancies_enquiry_idx` ON `overseas_vacancies` (`enquiry_id`);--> statement-breakpoint
CREATE INDEX `placement_checkins_due_idx` ON `placement_checkins` (`completed_on`,`due_on`);--> statement-breakpoint
CREATE INDEX `placement_checkouts_invoice_idx` ON `placement_checkouts` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `placement_invoice_payments_invoice_idx` ON `placement_invoice_payments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `placement_invoices_status_idx` ON `placement_invoices` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `placement_invoices_employer_idx` ON `placement_invoices` (`employer_id`);--> statement-breakpoint
CREATE INDEX `placement_invoices_placement_idx` ON `placement_invoices` (`placement_id`);--> statement-breakpoint
CREATE INDEX `placement_invoices_enquiry_idx` ON `placement_invoices` (`enquiry_id`);--> statement-breakpoint
CREATE INDEX `placements_status_idx` ON `placements` (`status`);--> statement-breakpoint
CREATE INDEX `placements_caregiver_idx` ON `placements` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `placements_employer_idx` ON `placements` (`employer_id`);--> statement-breakpoint
CREATE INDEX `placements_enquiry_idx` ON `placements` (`enquiry_id`);--> statement-breakpoint
CREATE INDEX `vacancy_applications_caregiver_idx` ON `vacancy_applications` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `vacancy_applications_status_idx` ON `vacancy_applications` (`status`,`created_at`);