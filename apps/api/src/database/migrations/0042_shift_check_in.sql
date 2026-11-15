CREATE TABLE `check_in_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`early_minutes` int NOT NULL DEFAULT 60,
	`late_after_minutes` int NOT NULL DEFAULT 15,
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `check_in_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shift_checkins` (
	`shift_id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`wrong_codes` int NOT NULL DEFAULT 0,
	`checked_in_at` datetime(3),
	`in_by` enum('CAREGIVER','STAFF'),
	`in_by_user_id` varchar(36),
	`in_note` varchar(300),
	`in_latitude` decimal(9,6),
	`in_longitude` decimal(9,6),
	`in_accuracy_m` int,
	`in_distance_m` int,
	`checked_out_at` datetime(3),
	`out_by` enum('CAREGIVER','STAFF'),
	`out_by_user_id` varchar(36),
	`out_note` varchar(300),
	`out_latitude` decimal(9,6),
	`out_longitude` decimal(9,6),
	`out_accuracy_m` int,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `shift_checkins_shift_id` PRIMARY KEY(`shift_id`)
);
--> statement-breakpoint
CREATE INDEX `shift_checkins_booking_idx` ON `shift_checkins` (`booking_id`,`checked_in_at`);