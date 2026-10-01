CREATE TABLE `refresh_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`revoked` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`role` enum('ADMIN','STAFF','VERIFIER') NOT NULL DEFAULT 'STAFF',
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `caregivers` (
	`id` varchar(36) NOT NULL,
	`registration_number` varchar(32) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`permanent_address` text NOT NULL,
	`nic` varchar(20),
	`passport_number` varchar(20),
	`date_of_birth` date NOT NULL,
	`gender` enum('MALE','FEMALE','OTHER') NOT NULL,
	`civil_status` enum('SINGLE','MARRIED','DIVORCED','WIDOWED','OTHER') NOT NULL,
	`height_cm` int,
	`weight_kg` int,
	`primary_phone` varchar(20) NOT NULL,
	`secondary_phone` varchar(20),
	`emergency_contact_name` varchar(255) NOT NULL,
	`emergency_contact_number` varchar(20) NOT NULL,
	`emergency_contact_relationship` varchar(100) NOT NULL,
	`police_division` varchar(100),
	`police_station` varchar(100),
	`status` enum('DRAFT','REGISTERED','DOCUMENTS_PENDING','UNDER_VERIFICATION','VERIFIED','ACTIVE','INACTIVE','SUSPENDED','REJECTED') NOT NULL DEFAULT 'DRAFT',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` datetime,
	CONSTRAINT `caregivers_id` PRIMARY KEY(`id`),
	CONSTRAINT `caregivers_registration_number_unique` UNIQUE(`registration_number`),
	CONSTRAINT `caregivers_nic_unique` UNIQUE(`nic`),
	CONSTRAINT `caregivers_passport_number_unique` UNIQUE(`passport_number`),
	CONSTRAINT `caregivers_primary_phone_unique` UNIQUE(`primary_phone`)
);
--> statement-breakpoint
CREATE TABLE `experiences` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`employer_or_client` varchar(255) NOT NULL,
	`role` varchar(255) NOT NULL,
	`location` varchar(255),
	`country` varchar(100) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date,
	`description` text,
	`care_type` varchar(100),
	`patient_category` varchar(100),
	`reference_contact` varchar(255),
	`verification_status` enum('PENDING','IN_PROGRESS','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `experiences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qualifications` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`type` enum('NVQ','NURSING_DIPLOMA','NURSING_DEGREE','CAREGIVER_CERTIFICATE','FIRST_AID','OTHER') NOT NULL,
	`institution` varchar(255) NOT NULL,
	`certificate_number` varchar(100),
	`issue_date` date,
	`expiry_date` date,
	`verification_status` enum('PENDING','IN_PROGRESS','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`document_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `qualifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_skills` (
	`caregiver_id` varchar(36) NOT NULL,
	`skill_id` varchar(36) NOT NULL,
	`proficiency` enum('BASIC','INTERMEDIATE','ADVANCED','EXPERT') NOT NULL DEFAULT 'BASIC',
	`years_of_experience` int DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_skills_caregiver_id_skill_id_pk` PRIMARY KEY(`caregiver_id`,`skill_id`)
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` varchar(36) NOT NULL,
	`name` varchar(150) NOT NULL,
	`category` varchar(100),
	`description` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `skills_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_languages` (
	`caregiver_id` varchar(36) NOT NULL,
	`language_id` varchar(36) NOT NULL,
	`proficiency` enum('BASIC','CONVERSATIONAL','FLUENT','NATIVE') NOT NULL DEFAULT 'CONVERSATIONAL',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_languages_caregiver_id_language_id_pk` PRIMARY KEY(`caregiver_id`,`language_id`)
);
--> statement-breakpoint
CREATE TABLE `languages` (
	`id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`code` varchar(10),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `languages_id` PRIMARY KEY(`id`),
	CONSTRAINT `languages_name_unique` UNIQUE(`name`),
	CONSTRAINT `languages_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` varchar(36) NOT NULL,
	`district` varchar(100) NOT NULL,
	`city` varchar(100) NOT NULL,
	`province` varchar(100) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `locations_district_city_unique` UNIQUE(`district`,`city`)
);
--> statement-breakpoint
CREATE TABLE `preferred_locations` (
	`caregiver_id` varchar(36) NOT NULL,
	`location_id` varchar(36) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `preferred_locations_caregiver_id_location_id_pk` PRIMARY KEY(`caregiver_id`,`location_id`)
);
--> statement-breakpoint
CREATE TABLE `availability` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`day_duty` boolean NOT NULL DEFAULT false,
	`night_duty` boolean NOT NULL DEFAULT false,
	`live_in_24h` boolean NOT NULL DEFAULT false,
	`available_from` date,
	`preferred_shift` enum('DAY','NIGHT','TWENTY_FOUR_HOUR_LIVE_IN','FLEXIBLE') NOT NULL DEFAULT 'FLEXIBLE',
	`expected_daily_rate` decimal(10,2),
	`expected_monthly_rate` decimal(10,2),
	`expected_leave_days` int,
	`preferred_leave_pattern` varchar(255),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `availability_id` PRIMARY KEY(`id`),
	CONSTRAINT `availability_caregiver_id_unique` UNIQUE(`caregiver_id`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_documents` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`document_type` enum('NIC','PASSPORT','GRAMA_NILADHARI_CERTIFICATE','POLICE_CLEARANCE','CAREGIVER_CERTIFICATE','NVQ_CERTIFICATE','NURSING_CERTIFICATE','CV','OTHER') NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`original_filename` varchar(255) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` int NOT NULL,
	`checksum` varchar(64) NOT NULL,
	`uploaded_by_user_id` varchar(36),
	`verification_status` enum('PENDING','IN_PROGRESS','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`verified_by_user_id` varchar(36),
	`verified_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `caregiver_documents_storage_key_unique` UNIQUE(`storage_key`)
);
--> statement-breakpoint
CREATE TABLE `references` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`relationship` varchar(100) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`email` varchar(255),
	`verification_status` enum('PENDING','IN_PROGRESS','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`notes` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `references_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`verification_type` enum('IDENTITY','POLICE_CLEARANCE','QUALIFICATION','EXPERIENCE','REFERENCE','OVERALL') NOT NULL,
	`status` enum('PENDING','IN_PROGRESS','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`verified_by_user_id` varchar(36),
	`verified_at` datetime,
	`notes` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_health_information` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`has_diabetes` boolean NOT NULL DEFAULT false,
	`has_high_blood_pressure` boolean NOT NULL DEFAULT false,
	`surgical_history` text,
	`mental_health_information` text,
	`physical_ability_to_lift_patients` boolean NOT NULL DEFAULT true,
	`other_notes` text,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_health_information_id` PRIMARY KEY(`id`),
	CONSTRAINT `caregiver_health_information_caregiver_id_unique` UNIQUE(`caregiver_id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(100) NOT NULL,
	`entity_id` varchar(36),
	`metadata` json,
	`ip_address` varchar(45),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `caregivers_status_idx` ON `caregivers` (`status`);--> statement-breakpoint
CREATE INDEX `caregivers_name_idx` ON `caregivers` (`full_name`);--> statement-breakpoint
CREATE INDEX `experiences_caregiver_idx` ON `experiences` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `qualifications_caregiver_idx` ON `qualifications` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `caregiver_skills_skill_idx` ON `caregiver_skills` (`skill_id`);--> statement-breakpoint
CREATE INDEX `caregiver_languages_language_idx` ON `caregiver_languages` (`language_id`);--> statement-breakpoint
CREATE INDEX `preferred_locations_location_idx` ON `preferred_locations` (`location_id`);--> statement-breakpoint
CREATE INDEX `caregiver_documents_caregiver_idx` ON `caregiver_documents` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `references_caregiver_idx` ON `references` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `verifications_caregiver_idx` ON `verifications` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);