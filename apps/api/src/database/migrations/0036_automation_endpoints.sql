CREATE TABLE `automation_endpoints` (
	`id` varchar(36) NOT NULL,
	`name` varchar(80) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`provider` enum('OLLAMA','OPENAI_COMPATIBLE','ANTHROPIC') NOT NULL DEFAULT 'OLLAMA',
	`base_url` varchar(255) NOT NULL,
	`model` varchar(120) NOT NULL,
	`api_key_encrypted` text,
	`temperature` decimal(3,2) DEFAULT '0.20',
	`max_tokens` int NOT NULL DEFAULT 1024,
	`timeout_ms` int NOT NULL DEFAULT 30000,
	`cleared_for` enum('PUBLIC','PERSONAL','SENSITIVE') NOT NULL DEFAULT 'PUBLIC',
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `automation_endpoints_id` PRIMARY KEY(`id`),
	CONSTRAINT `automation_endpoints_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `automation_functions` ADD `endpoint_id` varchar(36);--> statement-breakpoint
ALTER TABLE `automation_functions` ADD `fallback_endpoint_id` varchar(36);