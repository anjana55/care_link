CREATE TABLE `talk_requests` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` enum('CLIENT','CAREGIVER') NOT NULL,
	`about_type` enum('REQUEST','BOOKING','SHIFT'),
	`about_id` varchar(36),
	`message` text NOT NULL,
	`contact` enum('CALL','WHATSAPP','EMAIL') NOT NULL,
	`status` enum('OPEN','HANDLED') NOT NULL DEFAULT 'OPEN',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`handled_at` datetime,
	`handled_by_user_id` varchar(36),
	`staff_note` varchar(500),
	CONSTRAINT `talk_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `talk_requests_user_idx` ON `talk_requests` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `talk_requests_status_idx` ON `talk_requests` (`status`,`created_at`);