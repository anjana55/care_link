CREATE TABLE `ads_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`publisher_id` varchar(32),
	`slot_home` varchar(20),
	`slot_search` varchar(20),
	`slot_profile` varchar(20),
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ads_settings_id` PRIMARY KEY(`id`)
);
