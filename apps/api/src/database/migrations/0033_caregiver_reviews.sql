CREATE TABLE `caregiver_rating_stats` (
	`caregiver_id` varchar(36) NOT NULL,
	`rating_count` int NOT NULL DEFAULT 0,
	`rating_sum` int NOT NULL DEFAULT 0,
	`badge_counts` json NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `caregiver_rating_stats_caregiver_id` PRIMARY KEY(`caregiver_id`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_review_badges` (
	`review_id` varchar(36) NOT NULL,
	`badge` enum('PUNCTUAL','KIND_PATIENT','CLEAN_TIDY','SKILLED_CARE','SAFE_HANDLING','GOOD_COMMUNICATION','RESPECTFUL','TRUSTWORTHY','GOOD_COOK','EXTRA_MILE') NOT NULL,
	CONSTRAINT `caregiver_review_badges_pk` PRIMARY KEY(`review_id`,`badge`)
);
--> statement-breakpoint
CREATE TABLE `caregiver_reviews` (
	`id` varchar(36) NOT NULL,
	`booking_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`patient_id` varchar(36) NOT NULL,
	`reviewer_user_id` varchar(36),
	`rating` tinyint NOT NULL,
	`improvement_tags` varchar(120),
	`comment` text,
	`comment_language` enum('en','si','ta'),
	`comment_status` enum('NONE','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'NONE',
	`comment_reject_reason` varchar(300),
	`comment_reviewed_by_user_id` varchar(36),
	`comment_reviewed_at` datetime,
	`private_note` varchar(500),
	`hidden_at` datetime,
	`hidden_by_user_id` varchar(36),
	`hidden_reason` varchar(300),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `caregiver_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `caregiver_reviews_booking_caregiver_unique` UNIQUE(`booking_id`,`caregiver_id`)
);
--> statement-breakpoint
CREATE TABLE `review_requests` (
	`booking_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`stage` enum('ASK','REMINDER') NOT NULL,
	`sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `review_requests_pk` PRIMARY KEY(`booking_id`,`caregiver_id`,`stage`)
);
--> statement-breakpoint
CREATE TABLE `review_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`min_ratings_to_show` int NOT NULL DEFAULT 3,
	`window_days` int NOT NULL DEFAULT 90,
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `review_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `booking_events` MODIFY COLUMN `type` enum('CREATED','UPDATED','REGENERATED','RESCHEDULED','CONFIRMED','EXTENDED','SHIFT_ADDED','SHIFT_CHANGED','SHIFT_REMOVED','NOTE','COMPLETED','CANCELLED','AMENDED','ISSUE_REPORTED','ISSUE_CLOSED','CARE_PLAN_SET','CARE_PLAN_CHANGED','REVIEWED') NOT NULL;--> statement-breakpoint
CREATE INDEX `caregiver_reviews_caregiver_idx` ON `caregiver_reviews` (`caregiver_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `caregiver_reviews_comment_status_idx` ON `caregiver_reviews` (`comment_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `caregiver_reviews_patient_idx` ON `caregiver_reviews` (`patient_id`);