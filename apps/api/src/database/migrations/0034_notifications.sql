CREATE TABLE `announcements` (
	`id` varchar(36) NOT NULL,
	`audience` enum('CLIENTS','CAREGIVERS','ALL') NOT NULL,
	`text` json NOT NULL,
	`link` varchar(500),
	`important` boolean NOT NULL DEFAULT false,
	`send_push` boolean NOT NULL DEFAULT true,
	`send_whatsapp` boolean NOT NULL DEFAULT false,
	`created_by_user_id` varchar(36),
	`published_at` datetime,
	`recipients` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`id` varchar(36) NOT NULL,
	`reminders_enabled` boolean NOT NULL DEFAULT true,
	`quiet_start_hour` int NOT NULL DEFAULT 21,
	`quiet_end_hour` int NOT NULL DEFAULT 7,
	`daily_reminder_cap` int NOT NULL DEFAULT 2,
	`retention_days` int NOT NULL DEFAULT 180,
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `notification_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`category` enum('BOOKING','REQUEST','INVOICE','PAYOUT','REVIEW','CARE','DOCUMENT','ANNOUNCEMENT','REMINDER','OTHER') NOT NULL,
	`text` json NOT NULL,
	`path` varchar(255) NOT NULL,
	`link` varchar(500),
	`important` boolean NOT NULL DEFAULT false,
	`announcement_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`read_at` datetime,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reminder_sends` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`item_key` varchar(160) NOT NULL,
	`stage` varchar(24) NOT NULL,
	`sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `reminder_sends_id` PRIMARY KEY(`id`),
	CONSTRAINT `reminder_sends_once` UNIQUE(`user_id`,`item_key`,`stage`)
);
--> statement-breakpoint
CREATE INDEX `announcements_created_idx` ON `announcements` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notifications_announcement_idx` ON `notifications` (`announcement_id`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `reminder_sends_user_sent_idx` ON `reminder_sends` (`user_id`,`sent_at`);