-- Trilingual province/district/city reference data.
--
-- Replaces the old free-text `locations` table (district, city, province as
-- three English-only varchar columns) with three real tables keyed on the ids
-- the source CSVs carry, each holding its name in Sinhala, Tamil and English.
--
-- Two things in here are destructive and deliberate. The caregivers' existing
-- location values are nulled rather than matched by name, and
-- preferred_locations is dropped and recreated. Both are because names are not
-- identities: ten city names in the new data appear under more than one
-- district, so a name-based backfill would silently attach a caregiver to the
-- wrong place. The rows are re-entered through the registration form instead.

CREATE TABLE `provinces` (
	`id` int NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_si` varchar(100) NOT NULL,
	`name_ta` varchar(100) NOT NULL,
	PRIMARY KEY (`id`)
);--> statement-breakpoint
CREATE TABLE `districts` (
	`id` int NOT NULL,
	`province_id` int NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_si` varchar(100) NOT NULL,
	`name_ta` varchar(100) NOT NULL,
	PRIMARY KEY (`id`),
	KEY `districts_province_idx` (`province_id`),
	CONSTRAINT `districts_province_id_provinces_id_fk` FOREIGN KEY (`province_id`) REFERENCES `provinces`(`id`) ON DELETE no action ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE `cities` (
	`id` int NOT NULL,
	`district_id` int NOT NULL,
	`name_en` varchar(100) NOT NULL,
	`name_si` varchar(100) NOT NULL,
	`name_ta` varchar(100) NOT NULL,
	`sub_name_en` varchar(100),
	`sub_name_si` varchar(100),
	`sub_name_ta` varchar(100),
	`postcode` varchar(10),
	`latitude` decimal(10,8) NOT NULL,
	`longitude` decimal(11,8) NOT NULL,
	PRIMARY KEY (`id`),
	KEY `cities_district_idx` (`district_id`),
	KEY `cities_name_en_idx` (`name_en`),
	CONSTRAINT `cities_district_id_districts_id_fk` FOREIGN KEY (`district_id`) REFERENCES `districts`(`id`) ON DELETE no action ON UPDATE no action
);--> statement-breakpoint
ALTER TABLE `caregivers` ADD COLUMN `district_id` int;--> statement-breakpoint
ALTER TABLE `caregivers` ADD COLUMN `city_id` int;--> statement-breakpoint
ALTER TABLE `caregivers` DROP INDEX `caregivers_public_search_idx`;--> statement-breakpoint
CREATE INDEX `caregivers_public_search_idx` ON `caregivers` (`status`,`district_id`,`city_id`);--> statement-breakpoint
-- See the header: no name-based backfill, because names are ambiguous here.
UPDATE `caregivers` SET `district` = NULL, `city` = NULL, `postal_code` = NULL;--> statement-breakpoint
DROP TABLE `preferred_locations`;--> statement-breakpoint
CREATE TABLE `preferred_locations` (
	`caregiver_id` varchar(36) NOT NULL,
	`city_id` int NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`caregiver_id`,`city_id`),
	KEY `preferred_locations_city_idx` (`city_id`),
	CONSTRAINT `preferred_locations_city_id_cities_id_fk` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE no action ON UPDATE no action
);--> statement-breakpoint
DROP TABLE `locations`;