CREATE TABLE `jobs` (
	`id` varchar(36) NOT NULL,
	`type` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`unique_key` varchar(191),
	`status` enum('PENDING','RUNNING','DONE','FAILED') NOT NULL DEFAULT 'PENDING',
	`run_at` datetime(3) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`locked_at` datetime(3),
	`locked_by` varchar(64),
	`last_error` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`finished_at` datetime(3),
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_unique_key` UNIQUE(`unique_key`)
);
--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_type_idx` ON `jobs` (`type`,`status`);