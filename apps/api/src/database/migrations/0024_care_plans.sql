CREATE TABLE `care_activity_records` (
	`id` varchar(36) NOT NULL,
	`plan_activity_id` varchar(36) NOT NULL,
	`shift_id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`due_key` varchar(10) NOT NULL,
	`due_date` date NOT NULL,
	`status` enum('DONE','NOT_DONE','VOID') NOT NULL,
	`source` enum('CLIENT','AUTO','STAFF') NOT NULL,
	`reason` varchar(300),
	`is_critical` boolean NOT NULL DEFAULT false,
	`recorded_by_user_id` varchar(36),
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `care_activity_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `care_activity_records_occurrence_unique` UNIQUE(`plan_activity_id`,`shift_id`,`due_key`)
);
--> statement-breakpoint
CREATE TABLE `care_plan_activities` (
	`id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`category` enum('PERSONAL_CARE','MEDICATION','MOBILITY','NUTRITION','VITAL_SIGNS','HOUSEHOLD','COMPANIONSHIP','OTHER') NOT NULL,
	`title` json NOT NULL,
	`instructions` json,
	`timing` enum('ANY','SLOT','AT_TIMES') NOT NULL DEFAULT 'ANY',
	`slot` enum('MORNING','AFTERNOON','EVENING','NIGHT'),
	`times` varchar(100),
	`days_of_week` varchar(13),
	`is_critical` boolean NOT NULL DEFAULT false,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`replaces_activity_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `care_plan_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `care_plan_template_activities` (
	`id` varchar(36) NOT NULL,
	`template_id` varchar(36) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`category` enum('PERSONAL_CARE','MEDICATION','MOBILITY','NUTRITION','VITAL_SIGNS','HOUSEHOLD','COMPANIONSHIP','OTHER') NOT NULL,
	`title` json NOT NULL,
	`instructions` json,
	`timing` enum('ANY','SLOT','AT_TIMES') NOT NULL DEFAULT 'ANY',
	`slot` enum('MORNING','AFTERNOON','EVENING','NIGHT'),
	`times` varchar(100),
	`days_of_week` varchar(13),
	`is_critical` boolean NOT NULL DEFAULT false,
	CONSTRAINT `care_plan_template_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `care_plan_templates` (
	`id` varchar(36) NOT NULL,
	`name` varchar(150) NOT NULL,
	`description` text,
	`care_types` varchar(100) NOT NULL DEFAULT '',
	`status` enum('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
	`created_by_user_id` varchar(36),
	`updated_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `care_plan_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `care_plans` (
	`id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`source_template_id` varchar(36),
	`source_template_name` varchar(150),
	`notes` text,
	`created_by_user_id` varchar(36),
	`updated_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `care_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `care_plans_booking_unique` UNIQUE(`booking_id`)
);
--> statement-breakpoint
CREATE TABLE `care_shift_reviews` (
	`shift_id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`cut_off_at` datetime NOT NULL,
	`finalized_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `care_shift_reviews_shift_id` PRIMARY KEY(`shift_id`)
);
--> statement-breakpoint
ALTER TABLE `booking_events` MODIFY COLUMN `type` enum('CREATED','UPDATED','REGENERATED','RESCHEDULED','CONFIRMED','EXTENDED','SHIFT_ADDED','SHIFT_CHANGED','SHIFT_REMOVED','NOTE','COMPLETED','CANCELLED','AMENDED','ISSUE_REPORTED','ISSUE_CLOSED','CARE_PLAN_SET','CARE_PLAN_CHANGED') NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_issue_reports` MODIFY COLUMN `category` enum('TIMES','DID_NOT_HAPPEN','WRONG_CAREGIVER','CHARGE','PAY','CARE_PLAN','OTHER') NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `care_reminders_enabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `care_activity_records_shift_idx` ON `care_activity_records` (`shift_id`);--> statement-breakpoint
CREATE INDEX `care_activity_records_booking_idx` ON `care_activity_records` (`booking_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `care_activity_records_attention_idx` ON `care_activity_records` (`due_date`,`is_critical`,`status`);--> statement-breakpoint
CREATE INDEX `care_plan_activities_plan_idx` ON `care_plan_activities` (`plan_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `care_plan_template_activities_template_idx` ON `care_plan_template_activities` (`template_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `care_plan_templates_status_idx` ON `care_plan_templates` (`status`,`name`);