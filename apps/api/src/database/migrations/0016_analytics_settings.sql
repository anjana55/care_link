CREATE TABLE `analytics_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`measurement_id` varchar(32),
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `analytics_settings_id` PRIMARY KEY(`id`)
);
