ALTER TABLE `request_offers` MODIFY COLUMN `request_id` varchar(36);--> statement-breakpoint
ALTER TABLE `request_offers` ADD `kind` enum('JOB','COVER') DEFAULT 'JOB' NOT NULL;--> statement-breakpoint
ALTER TABLE `request_offers` ADD `shift_id` varchar(36);--> statement-breakpoint
ALTER TABLE `request_offers` drop column `open_key`;--> statement-breakpoint
ALTER TABLE `request_offers` ADD `open_key` varchar(80) GENERATED ALWAYS AS (IF(status = 'OFFERED', CONCAT(COALESCE(shift_id, request_id), ':', caregiver_id), NULL)) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX `request_offers_open_unique` ON `request_offers` (`open_key`);--> statement-breakpoint
CREATE INDEX `request_offers_shift_idx` ON `request_offers` (`shift_id`,`status`);
