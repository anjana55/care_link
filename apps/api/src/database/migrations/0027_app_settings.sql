CREATE TABLE `app_settings` (
	`id` varchar(36) NOT NULL,
	`ios_minimum_version` varchar(16),
	`ios_latest_version` varchar(16),
	`ios_store_url` varchar(500),
	`android_minimum_version` varchar(16),
	`android_latest_version` varchar(16),
	`android_store_url` varchar(500),
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_id` PRIMARY KEY(`id`)
);
