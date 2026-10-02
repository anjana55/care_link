CREATE TABLE `whatsapp_auth_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`caregiver_enabled` boolean NOT NULL DEFAULT true,
	`customer_enabled` boolean NOT NULL DEFAULT true,
	`registration_enabled` boolean NOT NULL DEFAULT true,
	`login_enabled` boolean NOT NULL DEFAULT true,
	`recovery_enabled` boolean NOT NULL DEFAULT true,
	`provider` enum('META_CLOUD','CONSOLE') NOT NULL DEFAULT 'CONSOLE',
	`api_base_url` varchar(255) NOT NULL DEFAULT 'https://graph.facebook.com',
	`api_version` varchar(16) NOT NULL DEFAULT 'v21.0',
	`phone_number_id` varchar(64),
	`business_account_id` varchar(64),
	`access_token_encrypted` text,
	`template_name` varchar(128) NOT NULL DEFAULT 'carelink_otp',
	`template_language` varchar(16) NOT NULL DEFAULT 'en',
	`template_has_copy_code_button` boolean NOT NULL DEFAULT true,
	`otp_length` int NOT NULL DEFAULT 6,
	`otp_ttl_seconds` int NOT NULL DEFAULT 300,
	`otp_max_attempts` int NOT NULL DEFAULT 5,
	`otp_resend_cooldown_seconds` int NOT NULL DEFAULT 60,
	`otp_max_sends_per_hour` int NOT NULL DEFAULT 5,
	`default_country_code` varchar(4) NOT NULL DEFAULT '94',
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `whatsapp_auth_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_otps` (
	`id` varchar(36) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`purpose` enum('REGISTER','LOGIN','RECOVERY') NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL,
	`consumed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `whatsapp_otps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(255);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `phone_verified_at` datetime;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_phone_unique` UNIQUE(`phone`);--> statement-breakpoint
CREATE INDEX `whatsapp_otps_phone_purpose_idx` ON `whatsapp_otps` (`phone`,`purpose`);