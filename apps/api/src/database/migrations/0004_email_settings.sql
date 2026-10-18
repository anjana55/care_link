CREATE TABLE `email_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`host` varchar(255),
	`port` int NOT NULL DEFAULT 587,
	`secure` boolean NOT NULL DEFAULT false,
	`username` varchar(255),
	`password_encrypted` text,
	`from_name` varchar(128) NOT NULL DEFAULT 'CareLink',
	`from_address` varchar(255),
	`reply_to` varchar(255),
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `email_settings_id` PRIMARY KEY(`id`)
);
