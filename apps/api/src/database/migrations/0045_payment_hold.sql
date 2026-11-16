ALTER TABLE `bookings` ADD `payment_hold_invoice_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bookings` ADD `payment_hold_at` datetime;--> statement-breakpoint
ALTER TABLE `bookings` ADD `payment_hold_waived_invoice_id` varchar(36);