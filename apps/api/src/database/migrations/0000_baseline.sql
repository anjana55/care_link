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
	`email` varchar(255),
	`password_hash` varchar(255),
	`phone` varchar(20),
	`phone_verified_at` datetime,
	`full_name` varchar(255) NOT NULL,
	`role` enum('ADMIN','STAFF','VERIFIER','CAREGIVER','PATIENT_GUARDIAN') NOT NULL DEFAULT 'STAFF',
	`is_active` boolean NOT NULL DEFAULT true,
	`email_verified_at` datetime,
	`last_login_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`phone` varchar(20),
	`consent_accepted_at` datetime,
	`permanent_address` text,
	`date_of_birth` date,
	`gender` enum('MALE','FEMALE','OTHER'),
	`nic` varchar(20),
	`district_id` int,
	`city_id` int,
	`district` varchar(100),
	`city` varchar(100),
	`province` varchar(100),
	`postal_code` varchar(20),
	`notes` text,
	`status` enum('PENDING_REVIEW','ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING_REVIEW',
	`registrant_type` enum('SELF','GUARDIAN'),
	`recipient_name` varchar(255),
	`recipient_relationship` enum('PARENT','SPOUSE','CHILD','SIBLING','OTHER_RELATIVE','FRIEND','OTHER'),
	`recipient_age` smallint unsigned,
	`recipient_gender` enum('MALE','FEMALE','OTHER'),
	`alternate_phone` varchar(20),
	`preferred_contact_method` enum('PHONE_CALL','WHATSAPP','EMAIL'),
	`preferred_contact_time` enum('ANYTIME','MORNING','AFTERNOON','EVENING'),
	`care_address` varchar(500),
	`care_needs` text,
	`care_schedule` enum('DAY','NIGHT','LIVE_IN_24H','NOT_SURE'),
	`care_start` enum('IMMEDIATELY','WITHIN_WEEK','WITHIN_MONTH','JUST_EXPLORING'),
	`preferred_caregiver_gender` enum('NO_PREFERENCE','MALE','FEMALE'),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `patients_id` PRIMARY KEY(`id`),
	CONSTRAINT `patients_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `caregivers` (
	`id` varchar(36) NOT NULL,
	`public_id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`registration_number` varchar(32) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`permanent_address` text NOT NULL,
	`nic` varchar(20),
	`passport_number` varchar(20),
	`date_of_birth` date NOT NULL,
	`gender` enum('MALE','FEMALE','OTHER') NOT NULL,
	`civil_status` enum('SINGLE','MARRIED','DIVORCED','WIDOWED','OTHER') NOT NULL,
	`height_in` decimal(5,1),
	`weight_kg` int,
	`primary_phone` varchar(20) NOT NULL,
	`secondary_phone` varchar(20),
	`emergency_contact_name` varchar(255) NOT NULL,
	`emergency_contact_number` varchar(20) NOT NULL,
	`emergency_contact_relationship` varchar(100) NOT NULL,
	`police_division` varchar(100),
	`police_station` varchar(100),
	`district_id` int,
	`city_id` int,
	`district` varchar(100),
	`city` varchar(100),
	`postal_code` varchar(20),
	`status` enum('DRAFT','REGISTERED','DOCUMENTS_PENDING','UNDER_VERIFICATION','VERIFIED','ACTIVE','INACTIVE','SUSPENDED','REJECTED') NOT NULL DEFAULT 'DRAFT',
	`consent_accepted_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deleted_at` datetime,
	CONSTRAINT `caregivers_id` PRIMARY KEY(`id`),
	CONSTRAINT `caregivers_public_id_unique` UNIQUE(`public_id`),
	CONSTRAINT `caregivers_user_id_unique` UNIQUE(`user_id`),
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
CREATE TABLE `cities` (
	`id` int NOT NULL,
	`district_id` int NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_si` varchar(100) NOT NULL,
	`name_ta` varchar(100) NOT NULL,
	`sub_name_en` varchar(100),
	`sub_name_si` varchar(100),
	`sub_name_ta` varchar(100),
	`postcode` varchar(10),
	`latitude` decimal(10,8) NOT NULL,
	`longitude` decimal(11,8) NOT NULL,
	CONSTRAINT `cities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `districts` (
	`id` int NOT NULL,
	`province_id` int NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_si` varchar(100) NOT NULL,
	`name_ta` varchar(100) NOT NULL,
	CONSTRAINT `districts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `preferred_locations` (
	`caregiver_id` varchar(36) NOT NULL,
	`city_id` int NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `preferred_locations_caregiver_id_city_id_pk` PRIMARY KEY(`caregiver_id`,`city_id`)
);
--> statement-breakpoint
CREATE TABLE `provinces` (
	`id` int NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_si` varchar(100) NOT NULL,
	`name_ta` varchar(100) NOT NULL,
	CONSTRAINT `provinces_id` PRIMARY KEY(`id`)
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
CREATE TABLE `whatsapp_auth_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`caregiver_enabled` boolean NOT NULL DEFAULT true,
	`customer_enabled` boolean NOT NULL DEFAULT true,
	`registration_enabled` boolean NOT NULL DEFAULT true,
	`login_enabled` boolean NOT NULL DEFAULT true,
	`recovery_enabled` boolean NOT NULL DEFAULT true,
	`provider` enum('META_CLOUD','CONSOLE') NOT NULL DEFAULT 'CONSOLE',
	`api_base_url` varchar(255) NOT NULL DEFAULT 'https://graph.facebook.com',
	`api_version` varchar(16) NOT NULL DEFAULT 'v21.0',
	`phone_number_id` varchar(64),
	`business_account_id` varchar(64),
	`access_token_encrypted` text,
	`template_name` varchar(128) NOT NULL DEFAULT 'carelink_otp',
	`template_language` varchar(16) NOT NULL DEFAULT 'en',
	`template_has_copy_code_button` boolean NOT NULL DEFAULT true,
	`otp_length` int NOT NULL DEFAULT 6,
	`otp_ttl_seconds` int NOT NULL DEFAULT 300,
	`otp_max_attempts` int NOT NULL DEFAULT 5,
	`otp_resend_cooldown_seconds` int NOT NULL DEFAULT 60,
	`otp_max_sends_per_hour` int NOT NULL DEFAULT 5,
	`default_country_code` varchar(4) NOT NULL DEFAULT '94',
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `whatsapp_auth_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_otps` (
	`id` varchar(36) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`purpose` enum('REGISTER','LOGIN','RECOVERY') NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL,
	`consumed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `whatsapp_otps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `cities` ADD CONSTRAINT `cities_district_id_districts_id_fk` FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `districts` ADD CONSTRAINT `districts_province_id_provinces_id_fk` FOREIGN KEY (`province_id`) REFERENCES `provinces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `preferred_locations` ADD CONSTRAINT `preferred_locations_city_id_cities_id_fk` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `email_verification_tokens_user_idx` ON `email_verification_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `patients_user_idx` ON `patients` (`user_id`);--> statement-breakpoint
CREATE INDEX `patients_status_idx` ON `patients` (`status`);--> statement-breakpoint
CREATE INDEX `patients_location_idx` ON `patients` (`district_id`,`city_id`);--> statement-breakpoint
CREATE INDEX `caregivers_status_idx` ON `caregivers` (`status`);--> statement-breakpoint
CREATE INDEX `caregivers_name_idx` ON `caregivers` (`full_name`);--> statement-breakpoint
CREATE INDEX `caregivers_public_id_idx` ON `caregivers` (`public_id`);--> statement-breakpoint
CREATE INDEX `caregivers_public_search_idx` ON `caregivers` (`status`,`district_id`,`city_id`);--> statement-breakpoint
CREATE INDEX `experiences_caregiver_idx` ON `experiences` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `qualifications_caregiver_idx` ON `qualifications` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `caregiver_skills_skill_idx` ON `caregiver_skills` (`skill_id`);--> statement-breakpoint
CREATE INDEX `caregiver_languages_language_idx` ON `caregiver_languages` (`language_id`);--> statement-breakpoint
CREATE INDEX `cities_district_idx` ON `cities` (`district_id`);--> statement-breakpoint
CREATE INDEX `cities_name_en_idx` ON `cities` (`name_en`);--> statement-breakpoint
CREATE INDEX `districts_province_idx` ON `districts` (`province_id`);--> statement-breakpoint
CREATE INDEX `preferred_locations_city_idx` ON `preferred_locations` (`city_id`);--> statement-breakpoint
CREATE INDEX `caregiver_documents_caregiver_idx` ON `caregiver_documents` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `references_caregiver_idx` ON `references` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `verifications_caregiver_idx` ON `verifications` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_otps_phone_purpose_idx` ON `whatsapp_otps` (`phone`,`purpose`);