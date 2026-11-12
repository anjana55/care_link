ALTER TABLE `bookings` ADD `client_review_status` enum('ASKED','ACCEPTED','CHANGES_REQUESTED');--> statement-breakpoint
ALTER TABLE `bookings` ADD `client_asked_at` datetime;--> statement-breakpoint
ALTER TABLE `bookings` ADD `client_asked_by_user_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bookings` ADD `client_answered_at` datetime;--> statement-breakpoint
ALTER TABLE `bookings` ADD `client_review_note` varchar(500);