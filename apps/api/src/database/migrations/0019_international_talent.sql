CREATE TABLE `caregiver_overseas_profiles` (
	`caregiver_id` varchar(36) NOT NULL,
	`open_to_overseas` boolean NOT NULL DEFAULT false,
	`target_countries` json NOT NULL,
	`passport_held` boolean,
	`passport_expiry` date,
	`available_from` date,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_overseas_profiles_caregiver_id` PRIMARY KEY(`caregiver_id`)
);
--> statement-breakpoint
CREATE TABLE `employer_enquiries` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(16) NOT NULL,
	`organisation_name` varchar(200) NOT NULL,
	`organisation_type` enum('RECRUITMENT_AGENCY','CARE_HOME','HOSPITAL','HOME_CARE_PROVIDER','PRIVATE_FAMILY','OTHER') NOT NULL,
	`country` varchar(2) NOT NULL,
	`contact_name` varchar(150) NOT NULL,
	`email` varchar(255) NOT NULL,
	`phone` varchar(32),
	`website` varchar(255),
	`roles_count` int NOT NULL,
	`care_settings` json NOT NULL,
	`languages` varchar(255),
	`start_timeframe` varchar(100),
	`visa_sponsorship` enum('YES','NO','UNSURE') NOT NULL DEFAULT 'UNSURE',
	`message` text,
	`caregiver_id` varchar(36),
	`status` enum('NEW','IN_PROGRESS','INTRODUCED','PLACED','CLOSED') NOT NULL DEFAULT 'NEW',
	`staff_note` text,
	`placement_fee_amount` decimal(12,2),
	`placement_fee_currency` varchar(3),
	`assigned_to_user_id` varchar(36),
	`consent_accepted_at` datetime NOT NULL,
	`language` varchar(5) NOT NULL DEFAULT 'en',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `employer_enquiries_id` PRIMARY KEY(`id`),
	CONSTRAINT `employer_enquiries_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `shared_profiles` (
	`caregiver_id` varchar(36) NOT NULL,
	`slug` varchar(24) NOT NULL,
	`is_shared` boolean NOT NULL DEFAULT false,
	`first_name` varchar(60) NOT NULL,
	`headline` varchar(120),
	`bio` text,
	`photo_key` varchar(255),
	`photo_mime_type` varchar(50),
	`status` enum('DRAFT','PENDING_REVIEW','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
	`review_note` varchar(500),
	`reviewed_by_user_id` varchar(36),
	`reviewed_at` datetime,
	`consent_accepted_at` datetime,
	`consent_version` varchar(20),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `shared_profiles_caregiver_id` PRIMARY KEY(`caregiver_id`),
	CONSTRAINT `shared_profiles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `training_enrolments` (
	`id` varchar(36) NOT NULL,
	`programme_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`status` enum('INTERESTED','ENROLLED','COMPLETED','WITHDRAWN') NOT NULL DEFAULT 'INTERESTED',
	`completed_at` date,
	`staff_note` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `training_enrolments_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_enrolments_programme_caregiver_unique` UNIQUE(`programme_id`,`caregiver_id`)
);
--> statement-breakpoint
CREATE TABLE `training_programmes` (
	`id` varchar(36) NOT NULL,
	`category` enum('ENGLISH','CAREGIVING','OTHER') NOT NULL,
	`format` enum('IN_PERSON','ONLINE','BLENDED') NOT NULL,
	`title_en` varchar(200) NOT NULL,
	`title_si` varchar(200),
	`title_ta` varchar(200),
	`description_en` text NOT NULL,
	`description_si` text,
	`description_ta` text,
	`duration` varchar(100),
	`fee_lkr` decimal(12,2),
	`next_start_date` date,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `training_programmes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `caregiver_overseas_profiles` ADD CONSTRAINT `caregiver_overseas_profiles_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employer_enquiries` ADD CONSTRAINT `employer_enquiries_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_profiles` ADD CONSTRAINT `shared_profiles_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `training_enrolments` ADD CONSTRAINT `training_enrolments_programme_id_training_programmes_id_fk` FOREIGN KEY (`programme_id`) REFERENCES `training_programmes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `training_enrolments` ADD CONSTRAINT `training_enrolments_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employer_enquiries_status_idx` ON `employer_enquiries` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `employer_enquiries_caregiver_idx` ON `employer_enquiries` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `shared_profiles_status_idx` ON `shared_profiles` (`status`);--> statement-breakpoint
CREATE INDEX `training_enrolments_caregiver_idx` ON `training_enrolments` (`caregiver_id`);