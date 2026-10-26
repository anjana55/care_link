CREATE TABLE `employer_shortlist` (
	`employer_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `employer_shortlist_employer_id_caregiver_id_pk` PRIMARY KEY(`employer_id`,`caregiver_id`)
);
--> statement-breakpoint
CREATE TABLE `employers` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`organisation_name` varchar(200) NOT NULL,
	`organisation_type` enum('RECRUITMENT_AGENCY','CARE_HOME','HOSPITAL','HOME_CARE_PROVIDER','PRIVATE_FAMILY','OTHER') NOT NULL,
	`country` varchar(2) NOT NULL,
	`contact_name` varchar(150) NOT NULL,
	`phone` varchar(32),
	`website` varchar(255),
	`company_registration_number` varchar(100),
	`status` enum('PENDING_REVIEW','VERIFIED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING_REVIEW',
	`review_note` varchar(500),
	`reviewed_by_user_id` varchar(36),
	`reviewed_at` datetime,
	`consent_accepted_at` datetime NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `employers_id` PRIMARY KEY(`id`),
	CONSTRAINT `employers_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `enquiry_candidates` (
	`id` varchar(36) NOT NULL,
	`enquiry_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`source` enum('STAFF','EMPLOYER') NOT NULL,
	`status` enum('PROPOSED','INTERVIEW_REQUESTED','INTERVIEW_SCHEDULED','SELECTED','PLACED','NOT_PROCEEDING') NOT NULL,
	`interview_at` datetime,
	`message_to_employer` varchar(1000),
	`employer_message` varchar(1000),
	`staff_note` varchar(1000),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `enquiry_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `enquiry_candidates_enquiry_caregiver_unique` UNIQUE(`enquiry_id`,`caregiver_id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('ADMIN','STAFF','VERIFIER','CAREGIVER','PATIENT_GUARDIAN','EMPLOYER') NOT NULL DEFAULT 'STAFF';--> statement-breakpoint
ALTER TABLE `employer_enquiries` ADD `employer_id` varchar(36);--> statement-breakpoint
ALTER TABLE `employer_shortlist` ADD CONSTRAINT `employer_shortlist_employer_id_employers_id_fk` FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employer_shortlist` ADD CONSTRAINT `employer_shortlist_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `enquiry_candidates` ADD CONSTRAINT `enquiry_candidates_enquiry_id_employer_enquiries_id_fk` FOREIGN KEY (`enquiry_id`) REFERENCES `employer_enquiries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `enquiry_candidates` ADD CONSTRAINT `enquiry_candidates_caregiver_id_caregivers_id_fk` FOREIGN KEY (`caregiver_id`) REFERENCES `caregivers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employers_status_idx` ON `employers` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `enquiry_candidates_caregiver_idx` ON `enquiry_candidates` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `enquiry_candidates_status_idx` ON `enquiry_candidates` (`status`);--> statement-breakpoint
ALTER TABLE `employer_enquiries` ADD CONSTRAINT `employer_enquiries_employer_id_employers_id_fk` FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `employer_enquiries_employer_idx` ON `employer_enquiries` (`employer_id`);