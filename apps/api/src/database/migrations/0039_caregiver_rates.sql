CREATE TABLE `care_type_pricing` (
	`care_type` enum('HOME_SHIFT','LIVE_IN','HOSPITAL','NURSING_HOME','RETIREMENT_HOME') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`rate_type` enum('HOURLY','DAILY','MONTHLY') NOT NULL,
	`min_rate` decimal(10,2) NOT NULL DEFAULT 0,
	`max_rate` decimal(10,2) NOT NULL DEFAULT 0,
	`fee_percent` decimal(5,2) NOT NULL DEFAULT 0,
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `care_type_pricing_care_type` PRIMARY KEY(`care_type`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_rates` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`care_type` enum('HOME_SHIFT','LIVE_IN','HOSPITAL','NURSING_HOME','RETIREMENT_HOME') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_rates_id` PRIMARY KEY(`id`),
	CONSTRAINT `caregiver_rates_caregiver_care_type` UNIQUE(`caregiver_id`,`care_type`)
);
