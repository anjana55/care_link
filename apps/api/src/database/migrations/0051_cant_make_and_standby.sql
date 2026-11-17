ALTER TABLE `booking_shifts` ADD `cant_make_at` datetime;--> statement-breakpoint
ALTER TABLE `booking_shifts` ADD `cant_make_note` varchar(200);--> statement-breakpoint
ALTER TABLE `booking_shifts` ADD `cant_make_caregiver_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bookings` ADD `standby_caregiver_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bookings` ADD `standby_set_by` enum('STAFF','AGENT');