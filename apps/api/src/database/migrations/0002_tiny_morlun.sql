CREATE TABLE `social_auth_provider_settings` (
	`provider` enum('GOOGLE','MICROSOFT','FACEBOOK') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`client_id` varchar(255),
	`client_secret_encrypted` text,
	`tenant` varchar(128),
	`api_version` varchar(16),
	`updated_by` varchar(36),
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `social_auth_provider_settings_provider` PRIMARY KEY(`provider`)
);
