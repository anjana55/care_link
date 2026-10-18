ALTER TABLE `care_request_events` MODIFY COLUMN `type` enum('CREATED','STATUS_CHANGED','NOTE','ASSIGNED','CANCELLED','CAREGIVER_CHANGED') NOT NULL;--> statement-breakpoint
ALTER TABLE `care_requests` MODIFY COLUMN `caregiver_id` varchar(36);--> statement-breakpoint
ALTER TABLE `care_requests` ADD `source` enum('WEB','PHONE') DEFAULT 'WEB' NOT NULL;--> statement-breakpoint
ALTER TABLE `care_requests` ADD `created_by_user_id` varchar(36);