CREATE TABLE `account_claim_codes` (
	`id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`channel` enum('EMAIL','STAFF') NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL,
	`expires_at` datetime NOT NULL,
	`consumed_at` datetime,
	`created_by` varchar(36),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `account_claim_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `caregivers` DROP INDEX `caregivers_nic_unique`;--> statement-breakpoint
ALTER TABLE `caregivers` DROP INDEX `caregivers_passport_number_unique`;--> statement-breakpoint
ALTER TABLE `caregivers` DROP INDEX `caregivers_primary_phone_unique`;--> statement-breakpoint
ALTER TABLE `whatsapp_otps` MODIFY COLUMN `purpose` enum('REGISTER','LOGIN','RECOVERY','CLAIM') NOT NULL;--> statement-breakpoint
ALTER TABLE `caregivers` ADD `live_nic` varchar(20) GENERATED ALWAYS AS (IF(deleted_at IS NULL, nic, NULL)) STORED;--> statement-breakpoint
ALTER TABLE `caregivers` ADD `live_passport_number` varchar(20) GENERATED ALWAYS AS (IF(deleted_at IS NULL, passport_number, NULL)) STORED;--> statement-breakpoint
ALTER TABLE `caregivers` ADD `live_primary_phone` varchar(20) GENERATED ALWAYS AS (IF(deleted_at IS NULL, primary_phone, NULL)) STORED;--> statement-breakpoint
ALTER TABLE `caregivers` ADD CONSTRAINT `caregivers_live_nic_unique` UNIQUE(`live_nic`);--> statement-breakpoint
ALTER TABLE `caregivers` ADD CONSTRAINT `caregivers_live_passport_number_unique` UNIQUE(`live_passport_number`);--> statement-breakpoint
ALTER TABLE `caregivers` ADD CONSTRAINT `caregivers_live_primary_phone_unique` UNIQUE(`live_primary_phone`);--> statement-breakpoint
CREATE INDEX `account_claim_codes_caregiver_idx` ON `account_claim_codes` (`caregiver_id`);--> statement-breakpoint
-- Backfill: caregivers deleted before this release kept a live, signable login
-- (email, phone, provider links, refresh tokens). Release them exactly the way
-- CaregiversService.remove now does, recording what was released first.
INSERT INTO `audit_logs` (`id`, `user_id`, `action`, `entity_type`, `entity_id`, `metadata`)
SELECT UUID(), NULL, 'RELEASE_CAREGIVER_IDENTITY', 'Caregiver', c.`id`,
       JSON_OBJECT('releasedEmail', u.`email`, 'releasedPhone', u.`phone`, 'reason', 'migration 0003: caregiver deleted before identity release existed')
FROM `caregivers` c JOIN `users` u ON u.`id` = c.`user_id`
WHERE c.`deleted_at` IS NOT NULL AND (u.`is_active` = true OR u.`email` IS NOT NULL OR u.`phone` IS NOT NULL);--> statement-breakpoint
DELETE sa FROM `social_accounts` sa JOIN `caregivers` c ON c.`user_id` = sa.`user_id` WHERE c.`deleted_at` IS NOT NULL;--> statement-breakpoint
UPDATE `refresh_tokens` rt JOIN `caregivers` c ON c.`user_id` = rt.`user_id` SET rt.`revoked` = true WHERE c.`deleted_at` IS NOT NULL;--> statement-breakpoint
UPDATE `users` u JOIN `caregivers` c ON c.`user_id` = u.`id`
SET u.`is_active` = false, u.`email` = NULL, u.`phone` = NULL, u.`password_hash` = NULL,
    u.`email_verified_at` = NULL, u.`phone_verified_at` = NULL
WHERE c.`deleted_at` IS NOT NULL;
