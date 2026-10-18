CREATE TABLE `care_request_events` (
	`id` varchar(36) NOT NULL,
	`request_id` varchar(36) NOT NULL,
	`type` enum('CREATED','STATUS_CHANGED','NOTE','ASSIGNED','CANCELLED') NOT NULL,
	`from_status` enum('NEW','IN_PROGRESS','INTRODUCED','CLOSED','CANCELLED'),
	`to_status` enum('NEW','IN_PROGRESS','INTRODUCED','CLOSED','CANCELLED'),
	`close_reason` enum('CLIENT_NOT_PROCEEDING','CLIENT_UNREACHABLE','CAREGIVER_UNAVAILABLE','CAREGIVER_DECLINED','NOT_A_MATCH','PLACED','OTHER'),
	`note` text,
	`actor_user_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `care_request_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `care_requests` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(16) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`status` enum('NEW','IN_PROGRESS','INTRODUCED','CLOSED','CANCELLED') NOT NULL DEFAULT 'NEW',
	`message` text,
	`language` enum('en','si','ta') NOT NULL DEFAULT 'en',
	`assigned_to_user_id` varchar(36),
	`close_reason` enum('CLIENT_NOT_PROCEEDING','CLIENT_UNREACHABLE','CAREGIVER_UNAVAILABLE','CAREGIVER_DECLINED','NOT_A_MATCH','PLACED','OTHER'),
	`closed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`open_pair_key` varchar(80) GENERATED ALWAYS AS (IF(status IN ('NEW', 'IN_PROGRESS'), CONCAT(patient_id, ':', caregiver_id), NULL)) STORED,
	CONSTRAINT `care_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `care_requests_reference_unique` UNIQUE(`reference`),
	CONSTRAINT `care_requests_open_pair_unique` UNIQUE(`open_pair_key`)
);
--> statement-breakpoint
CREATE TABLE `saved_caregivers` (
	`patient_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `saved_caregivers_pk` PRIMARY KEY(`patient_id`,`caregiver_id`)
);
--> statement-breakpoint
ALTER TABLE `whatsapp_auth_settings` ADD `notifications_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `whatsapp_auth_settings` ADD `notification_template_name` varchar(128) DEFAULT 'carelink_update' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_settings` ADD `request_alerts_to` varchar(1000);--> statement-breakpoint
CREATE INDEX `care_request_events_request_idx` ON `care_request_events` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `care_requests_patient_idx` ON `care_requests` (`patient_id`);--> statement-breakpoint
CREATE INDEX `care_requests_caregiver_idx` ON `care_requests` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `care_requests_status_idx` ON `care_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `saved_caregivers_caregiver_idx` ON `saved_caregivers` (`caregiver_id`);