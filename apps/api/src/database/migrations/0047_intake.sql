ALTER TABLE `care_requests` ADD `schedule` enum('DAY','NIGHT','LIVE_IN_24H','NOT_SURE');--> statement-breakpoint
ALTER TABLE `care_requests` ADD `details_asked` varchar(80);--> statement-breakpoint
ALTER TABLE `care_requests` ADD `details_asked_at` datetime;--> statement-breakpoint
ALTER TABLE `care_requests` ADD `details_answered_at` datetime;--> statement-breakpoint
ALTER TABLE `care_requests` ADD `details_escalated_at` datetime;