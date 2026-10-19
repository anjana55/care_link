CREATE TABLE `ai_settings` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`provider` enum('OLLAMA','OPENAI_COMPATIBLE','ANTHROPIC') NOT NULL DEFAULT 'OLLAMA',
	`base_url` varchar(255) NOT NULL DEFAULT 'http://localhost:11434',
	`model` varchar(120) NOT NULL DEFAULT 'qwen2.5:7b-instruct',
	`api_key_encrypted` text,
	`temperature` decimal(3,2) NOT NULL DEFAULT '0.20',
	`max_tokens` int NOT NULL DEFAULT 1024,
	`timeout_ms` int NOT NULL DEFAULT 30000,
	`candidate_pool_size` int NOT NULL DEFAULT 20,
	`public_search_enabled` boolean NOT NULL DEFAULT true,
	`staff_matching_enabled` boolean NOT NULL DEFAULT true,
	`staff_assistant_enabled` boolean NOT NULL DEFAULT true,
	`search_prompt` text,
	`assistant_prompt` text,
	`updated_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ai_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assistant_actions` (
	`id` varchar(36) NOT NULL,
	`conversation_id` varchar(36) NOT NULL,
	`message_id` varchar(36) NOT NULL,
	`tool` varchar(64) NOT NULL,
	`args` json NOT NULL,
	`summary` varchar(500) NOT NULL,
	`details` json,
	`status` enum('PENDING','EXECUTED','REJECTED','FAILED') NOT NULL DEFAULT 'PENDING',
	`result` json,
	`error` varchar(500),
	`decided_by_user_id` varchar(36),
	`decided_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `assistant_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assistant_conversations` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`title` varchar(120) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `assistant_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` varchar(36) NOT NULL,
	`conversation_id` varchar(36) NOT NULL,
	`role` enum('user','assistant','tool') NOT NULL,
	`content` text NOT NULL,
	`tool_calls` json,
	`tool_call_id` varchar(64),
	`tool_name` varchar(64),
	`links` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `assistant_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `assistant_actions_conversation_idx` ON `assistant_actions` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `assistant_actions_message_idx` ON `assistant_actions` (`message_id`);--> statement-breakpoint
CREATE INDEX `assistant_conversations_user_idx` ON `assistant_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `assistant_messages_conversation_idx` ON `assistant_messages` (`conversation_id`,`created_at`);