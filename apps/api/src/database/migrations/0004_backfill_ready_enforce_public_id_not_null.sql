-- Backfill before tightening, in the same migration. 0003 adds `public_id` as
-- nullable and 0004 makes it NOT NULL; the MySQL migrator applies every pending
-- migration inside one transaction, so there is no point at which an external
-- backfill script could be run in between. Rows created before this feature
-- would otherwise fail the NOT NULL constraint.
UPDATE `caregivers` SET `public_id` = UUID() WHERE `public_id` IS NULL;--> statement-breakpoint
ALTER TABLE `caregivers` MODIFY COLUMN `public_id` varchar(36) NOT NULL;
