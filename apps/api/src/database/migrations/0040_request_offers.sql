CREATE TABLE `request_offers` (
	`id` varchar(36) NOT NULL,
	`request_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`status` enum('OFFERED','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN') NOT NULL DEFAULT 'OFFERED',
	`rate_type` enum('HOURLY','DAILY','MONTHLY'),
	`pay_rate` decimal(10,2),
	`client_rate` decimal(10,2),
	`note` varchar(500),
	`decline_reason` enum('NOT_AVAILABLE','TOO_FAR','RATE_TOO_LOW','OTHER'),
	`sent_by_user_id` varchar(36),
	`expires_at` datetime(3) NOT NULL,
	`responded_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`open_key` varchar(80) GENERATED ALWAYS AS (IF(status = 'OFFERED', CONCAT(request_id, ':', caregiver_id), NULL)) STORED,
	CONSTRAINT `request_offers_id` PRIMARY KEY(`id`),
	CONSTRAINT `request_offers_open_unique` UNIQUE(`open_key`)
);
--> statement-breakpoint
CREATE INDEX `request_offers_request_idx` ON `request_offers` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `request_offers_caregiver_idx` ON `request_offers` (`caregiver_id`,`status`,`expires_at`);