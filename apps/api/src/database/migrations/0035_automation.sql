CREATE TABLE `agent_decisions` (
	`id` varchar(36) NOT NULL,
	`function` enum('INTAKE','MATCHING','BOOKING','BILLING','LIVE_CARE','ONBOARDING') NOT NULL,
	`action` varchar(64) NOT NULL,
	`tier` int NOT NULL,
	`case_type` enum('REQUEST','BOOKING','SHIFT','INVOICE','PAYOUT','CAREGIVER'),
	`case_id` varchar(36),
	`mode` enum('MANUAL','SHADOW','ASSIST','AUTO') NOT NULL,
	`outcome` enum('SHADOW','PROPOSED','EXECUTED') NOT NULL,
	`reason` varchar(500) NOT NULL,
	`confidence` decimal(4,3),
	`proposal` json,
	`model` varchar(120),
	`prompt_version` varchar(40),
	`staff_verdict` enum('AGREED','DIFFERED','REVERSED','SERIOUS'),
	`staff_note` varchar(500),
	`reviewed_by_user_id` varchar(36),
	`reviewed_at` datetime,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `agent_decisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automation_action_policies` (
	`action` varchar(64) NOT NULL,
	`auto_allowed` boolean NOT NULL DEFAULT false,
	`limits` json,
	`record_since` datetime(3),
	`promoted_at` datetime,
	`promoted_by` varchar(36),
	`demoted_at` datetime,
	`demote_reason` varchar(255),
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `automation_action_policies_action` PRIMARY KEY(`action`)
);
--> statement-breakpoint
CREATE TABLE `automation_cases` (
	`id` varchar(36) NOT NULL,
	`case_type` enum('REQUEST','BOOKING','SHIFT','INVOICE','PAYOUT','CAREGIVER') NOT NULL,
	`case_id` varchar(36) NOT NULL,
	`driver` enum('AGENT','STAFF') NOT NULL DEFAULT 'AGENT',
	`taken_over_at` datetime,
	`taken_over_by_user_id` varchar(36),
	`takeover_source` enum('STAFF','PERSON'),
	`takeover_reason` varchar(500),
	`handover_note` json,
	`handover_note_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `automation_cases_id` PRIMARY KEY(`id`),
	CONSTRAINT `automation_cases_case_unique` UNIQUE(`case_type`,`case_id`)
);
--> statement-breakpoint
CREATE TABLE `automation_functions` (
	`key` enum('INTAKE','MATCHING','BOOKING','BILLING','LIVE_CARE','ONBOARDING') NOT NULL,
	`mode` enum('MANUAL','SHADOW','ASSIST','AUTO') NOT NULL DEFAULT 'MANUAL',
	`tripped_at` datetime,
	`trip_reason` varchar(500),
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `automation_functions_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `automation_settings` (
	`id` varchar(36) NOT NULL,
	`master_manual` boolean NOT NULL DEFAULT false,
	`master_reason` varchar(500),
	`master_at` datetime,
	`master_by` varchar(36),
	`promotion_cases` int NOT NULL DEFAULT 50,
	`promotion_agreement_percent` int NOT NULL DEFAULT 90,
	`demote_after_reversals` int NOT NULL DEFAULT 3,
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `automation_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `agent_decisions_function_created_idx` ON `agent_decisions` (`function`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_decisions_action_created_idx` ON `agent_decisions` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_decisions_case_idx` ON `agent_decisions` (`case_type`,`case_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_decisions_review_idx` ON `agent_decisions` (`action`,`staff_verdict`,`reviewed_at`);--> statement-breakpoint
CREATE INDEX `automation_cases_driver_idx` ON `automation_cases` (`driver`,`case_type`);