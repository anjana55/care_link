CREATE TABLE `candidate_interviews` (
	`id` varchar(36) NOT NULL,
	`candidate_id` varchar(36) NOT NULL,
	`round` int NOT NULL,
	`scheduled_at` datetime NOT NULL,
	`duration_minutes` int NOT NULL,
	`mode` enum('VIDEO','PHONE','IN_PERSON') NOT NULL,
	`meeting_link` varchar(500),
	`location` varchar(300),
	`instructions` varchar(1000),
	`status` enum('SCHEDULED','COMPLETED','CANCELLED','NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
	`cancel_reason` varchar(500),
	`feedback` varchar(2000),
	`created_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `candidate_interviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_assessments` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`kind` enum('ENGLISH','CAREGIVING_SKILLS','OTHER') NOT NULL,
	`provider` enum('PLATFORM','IELTS','OET','PTE','TOEFL','LANGUAGECERT','OTHER') NOT NULL,
	`title` varchar(120) NOT NULL,
	`score` varchar(20),
	`cefr_level` enum('A1','A2','B1','B2','C1','C2'),
	`taken_on` date NOT NULL,
	`valid_until` date,
	`added_by` enum('CAREGIVER','STAFF') NOT NULL,
	`verified_by_user_id` varchar(36),
	`verified_at` datetime,
	`note` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_assessments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_offers` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(16) NOT NULL,
	`candidate_id` varchar(36) NOT NULL,
	`enquiry_id` varchar(36) NOT NULL,
	`employer_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`status` enum('PENDING_REVIEW','RETURNED','SENT','ACCEPTED','DECLINED','WITHDRAWN') NOT NULL DEFAULT 'PENDING_REVIEW',
	`job_title` varchar(150) NOT NULL,
	`country` varchar(2) NOT NULL,
	`city` varchar(100),
	`start_date` date,
	`contract_months` int NOT NULL,
	`hours_per_week` int NOT NULL,
	`salary_amount` decimal(12,2) NOT NULL,
	`salary_currency` varchar(3) NOT NULL,
	`salary_period` enum('HOUR','MONTH','YEAR') NOT NULL,
	`accommodation` enum('PROVIDED_FREE','PROVIDED_PAID','NOT_PROVIDED') NOT NULL,
	`meals_provided` boolean NOT NULL DEFAULT false,
	`flights_paid_by` enum('EMPLOYER','CAREGIVER','SHARED') NOT NULL,
	`annual_leave_days` int,
	`probation_months` int,
	`other_terms` text,
	`expires_on` date,
	`terms_hash` varchar(64) NOT NULL,
	`employer_signature_name` varchar(120),
	`employer_signed_at` datetime,
	`employer_signed_by_user_id` varchar(36),
	`employer_signed_ip` varchar(45),
	`caregiver_signature_name` varchar(120),
	`caregiver_signed_at` datetime,
	`caregiver_signed_ip` varchar(45),
	`review_note` varchar(500),
	`reviewed_by_user_id` varchar(36),
	`decline_reason` varchar(500),
	`sent_at` datetime,
	`responded_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `job_offers_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_offers_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `placement_checklist_items` (
	`placement_id` varchar(36) NOT NULL,
	`item` enum('OFFER_ACCEPTED','MEDICAL','POLICE_CLEARANCE','CONTRACT_SIGNED','VISA_APPLIED','VISA_GRANTED','INSURANCE','ORIENTATION','FLIGHT_BOOKED') NOT NULL,
	`done_on` date,
	`due_on` date,
	`note` varchar(500),
	`updated_by_user_id` varchar(36),
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `placement_checklist_items_placement_id_item_pk` PRIMARY KEY(`placement_id`,`item`)
);
--> statement-breakpoint
CREATE TABLE `training_certificates` (
	`id` varchar(36) NOT NULL,
	`number` varchar(20) NOT NULL,
	`verify_code` varchar(12) NOT NULL,
	`enrolment_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`programme_id` varchar(36) NOT NULL,
	`programme_title` varchar(200) NOT NULL,
	`holder_name` varchar(255) NOT NULL,
	`holder_first_name` varchar(60) NOT NULL,
	`issued_on` date NOT NULL,
	`score` int,
	`issued_by_user_id` varchar(36),
	`revoked_at` datetime,
	`revoked_reason` varchar(500),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `training_certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_certificates_number_unique` UNIQUE(`number`),
	CONSTRAINT `training_certificates_verify_code_unique` UNIQUE(`verify_code`),
	CONSTRAINT `training_certificates_enrolment_id_unique` UNIQUE(`enrolment_id`)
);
--> statement-breakpoint
CREATE TABLE `welfare_report_messages` (
	`id` varchar(36) NOT NULL,
	`report_id` varchar(36) NOT NULL,
	`author_role` enum('CAREGIVER','STAFF') NOT NULL,
	`author_user_id` varchar(36),
	`body` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `welfare_report_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `welfare_reports` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(16) NOT NULL,
	`placement_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`severity` enum('QUESTION','CONCERN','URGENT','SOS') NOT NULL,
	`category` enum('PAY','HOURS','ACCOMMODATION','TREATMENT','HEALTH','CONTRACT','DOCUMENTS','SAFETY','OTHER') NOT NULL,
	`status` enum('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'OPEN',
	`acknowledged_at` datetime,
	`acknowledged_by_user_id` varchar(36),
	`resolved_at` datetime,
	`resolved_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `welfare_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `welfare_reports_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
ALTER TABLE `placements` ADD `departure_details` varchar(300);--> statement-breakpoint
ALTER TABLE `placements` ADD `address_abroad` varchar(500);--> statement-breakpoint
ALTER TABLE `placements` ADD `phone_abroad` varchar(30);--> statement-breakpoint
ALTER TABLE `training_enrolments` ADD `progress_percent` int;--> statement-breakpoint
ALTER TABLE `training_enrolments` ADD `score` int;--> statement-breakpoint
ALTER TABLE `training_programmes` ADD `pass_mark` int;--> statement-breakpoint
ALTER TABLE `candidate_interviews` ADD CONSTRAINT `candidate_interviews_candidate_id_enquiry_candidates_id_fk` FOREIGN KEY (`candidate_id`) REFERENCES `enquiry_candidates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `caregiver_assessments` ADD CONSTRAINT `caregiver_assessments_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_offers` ADD CONSTRAINT `job_offers_candidate_id_enquiry_candidates_id_fk` FOREIGN KEY (`candidate_id`) REFERENCES `enquiry_candidates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_offers` ADD CONSTRAINT `job_offers_enquiry_id_employer_enquiries_id_fk` FOREIGN KEY (`enquiry_id`) REFERENCES `employer_enquiries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_offers` ADD CONSTRAINT `job_offers_employer_id_employers_id_fk` FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_offers` ADD CONSTRAINT `job_offers_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placement_checklist_items` ADD CONSTRAINT `placement_checklist_items_placement_id_placements_id_fk` FOREIGN KEY (`placement_id`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `training_certificates` ADD CONSTRAINT `training_certificates_enrolment_id_training_enrolments_id_fk` FOREIGN KEY (`enrolment_id`) REFERENCES `training_enrolments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `training_certificates` ADD CONSTRAINT `training_certificates_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `training_certificates` ADD CONSTRAINT `training_certificates_programme_id_training_programmes_id_fk` FOREIGN KEY (`programme_id`) REFERENCES `training_programmes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `welfare_report_messages` ADD CONSTRAINT `welfare_report_messages_report_id_welfare_reports_id_fk` FOREIGN KEY (`report_id`) REFERENCES `welfare_reports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `welfare_reports` ADD CONSTRAINT `welfare_reports_placement_id_placements_id_fk` FOREIGN KEY (`placement_id`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `welfare_reports` ADD CONSTRAINT `welfare_reports_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `candidate_interviews_candidate_idx` ON `candidate_interviews` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `candidate_interviews_schedule_idx` ON `candidate_interviews` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `caregiver_assessments_caregiver_idx` ON `caregiver_assessments` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `caregiver_assessments_verified_idx` ON `caregiver_assessments` (`verified_at`);--> statement-breakpoint
CREATE INDEX `job_offers_candidate_idx` ON `job_offers` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `job_offers_caregiver_idx` ON `job_offers` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `job_offers_employer_idx` ON `job_offers` (`employer_id`);--> statement-breakpoint
CREATE INDEX `job_offers_status_idx` ON `job_offers` (`status`);--> statement-breakpoint
CREATE INDEX `training_certificates_caregiver_idx` ON `training_certificates` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `welfare_report_messages_report_idx` ON `welfare_report_messages` (`report_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `welfare_reports_status_idx` ON `welfare_reports` (`status`,`severity`);--> statement-breakpoint
CREATE INDEX `welfare_reports_placement_idx` ON `welfare_reports` (`placement_id`);--> statement-breakpoint
CREATE INDEX `welfare_reports_caregiver_idx` ON `welfare_reports` (`caregiver_id`);