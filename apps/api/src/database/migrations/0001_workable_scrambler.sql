CREATE TABLE `auth_handoff_codes` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`code_hash` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `auth_handoff_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`provider` enum('GOOGLE','MICROSOFT','FACEBOOK') NOT NULL,
	`provider_account_id` varchar(255) NOT NULL,
	`provider_email` varchar(255) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `social_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_accounts_provider_identity_idx` UNIQUE(`provider`,`provider_account_id`),
	CONSTRAINT `social_accounts_user_provider_idx` UNIQUE(`user_id`,`provider`)
);
--> statement-breakpoint
CREATE INDEX `auth_handoff_codes_user_idx` ON `auth_handoff_codes` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_handoff_codes_hash_idx` ON `auth_handoff_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `social_accounts_user_idx` ON `social_accounts` (`user_id`);