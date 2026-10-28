ALTER TABLE `care_plan_activities` MODIFY COLUMN `times` varchar(150);--> statement-breakpoint
ALTER TABLE `care_plan_template_activities` MODIFY COLUMN `times` varchar(150);--> statement-breakpoint
ALTER TABLE `care_plan_activities` ADD `reminder_minutes_before` smallint;--> statement-breakpoint
ALTER TABLE `care_plan_activities` ADD `on_time_minutes` smallint;--> statement-breakpoint
ALTER TABLE `care_plan_template_activities` ADD `reminder_minutes_before` smallint;--> statement-breakpoint
ALTER TABLE `care_plan_template_activities` ADD `on_time_minutes` smallint;