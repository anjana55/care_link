CREATE TABLE `booking_events` (
	`id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`type` enum('CREATED','REGENERATED','CONFIRMED','EXTENDED','SHIFT_ADDED','SHIFT_CHANGED','SHIFT_REMOVED','NOTE','COMPLETED','CANCELLED') NOT NULL,
	`note` text,
	`actor_user_id` varchar(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `booking_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_shifts` (
	`id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`starts_at` datetime NOT NULL,
	`ends_at` datetime NOT NULL,
	`status` enum('DRAFT','SCHEDULED','COMPLETED','MISSED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`note` varchar(500),
	`updated_by_user_id` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `booking_shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` varchar(36) NOT NULL,
	`reference` varchar(16) NOT NULL,
	`care_request_id` varchar(36),
	`patient_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`status` enum('DRAFT','CONFIRMED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`schedule_type` enum('DAY','NIGHT','LIVE_IN','CUSTOM') NOT NULL,
	`days_of_week` varchar(13) NOT NULL,
	`shift_start_time` char(5) NOT NULL,
	`shift_end_time` char(5) NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`rate_type` enum('HOURLY','DAILY','MONTHLY'),
	`rate_amount` decimal(10,2),
	`language` enum('en','si','ta') NOT NULL DEFAULT 'en',
	`notes` text,
	`created_by_user_id` varchar(36),
	`confirmed_at` datetime,
	`confirmed_by_user_id` varchar(36),
	`cancelled_at` datetime,
	`cancel_reason` varchar(500),
	`completed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE INDEX `booking_events_booking_idx` ON `booking_events` (`booking_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `booking_shifts_booking_idx` ON `booking_shifts` (`booking_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `booking_shifts_caregiver_idx` ON `booking_shifts` (`caregiver_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `bookings_patient_idx` ON `bookings` (`patient_id`);--> statement-breakpoint
CREATE INDEX `bookings_caregiver_idx` ON `bookings` (`caregiver_id`);--> statement-breakpoint
CREATE INDEX `bookings_request_idx` ON `bookings` (`care_request_id`);--> statement-breakpoint
CREATE INDEX `bookings_status_idx` ON `bookings` (`status`,`start_date`);