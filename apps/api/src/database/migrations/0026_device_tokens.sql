CREATE TABLE `device_tokens` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expo_push_token` varchar(255) NOT NULL,
	`platform` enum('ios','android') NOT NULL,
	`app_version` varchar(32),
	`locale` enum('en','si','ta') NOT NULL DEFAULT 'en',
	`last_seen_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`revoked_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `device_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `device_tokens_expo_push_token_unique` UNIQUE(`expo_push_token`)
);
--> statement-breakpoint
CREATE INDEX `device_tokens_user_idx` ON `device_tokens` (`user_id`);