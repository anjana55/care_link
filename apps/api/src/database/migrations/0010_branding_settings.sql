CREATE TABLE `branding_settings` (
	`id` varchar(36) NOT NULL,
	`company_name` varchar(120) NOT NULL DEFAULT 'CareLink',
	`short_name` varchar(4) NOT NULL DEFAULT 'CL',
	`tagline` varchar(160),
	`primary_color` varchar(7) NOT NULL DEFAULT '#5F6952',
	`accent_color` varchar(7) NOT NULL DEFAULT '#2F7A84',
	`logo_key` varchar(255),
	`logo_mime_type` varchar(40),
	`logo_version` varchar(40),
	`default_locale` enum('en','si','ta') NOT NULL DEFAULT 'en',
	`enabled_locales` varchar(32) NOT NULL DEFAULT 'en,si,ta',
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `branding_settings_id` PRIMARY KEY(`id`)
);
