ALTER TABLE `booking_events` MODIFY COLUMN `type` enum('CREATED','UPDATED','REGENERATED','RESCHEDULED','CONFIRMED','EXTENDED','SHIFT_ADDED','SHIFT_CHANGED','SHIFT_REMOVED','NOTE','COMPLETED','CANCELLED') NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_shifts` ADD `rate_type` enum('HOURLY','DAILY');--> statement-breakpoint
ALTER TABLE `booking_shifts` ADD `rate_amount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `booking_shifts` ADD `pay_rate_type` enum('HOURLY','DAILY');--> statement-breakpoint
ALTER TABLE `booking_shifts` ADD `pay_rate_amount` decimal(10,2);