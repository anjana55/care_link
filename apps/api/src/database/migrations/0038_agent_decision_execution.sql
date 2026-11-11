ALTER TABLE `agent_decisions` ADD `dedupe_key` varchar(191);--> statement-breakpoint
ALTER TABLE `agent_decisions` ADD `executed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `agent_decisions` ADD `execution_error` varchar(500);--> statement-breakpoint
ALTER TABLE `agent_decisions` ADD `result` json;--> statement-breakpoint
CREATE INDEX `agent_decisions_dedupe_idx` ON `agent_decisions` (`action`,`dedupe_key`);