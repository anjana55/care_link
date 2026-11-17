CREATE TABLE `document_readings` (
	`document_id` varchar(36) NOT NULL,
	`caregiver_id` varchar(36) NOT NULL,
	`outcome` enum('OK','CHECK','MISMATCH','EXPIRED','UNREADABLE') NOT NULL,
	`checks` json NOT NULL,
	`expires_on` varchar(10),
	`endpoint_name` varchar(100) NOT NULL,
	`model` varchar(150) NOT NULL,
	`read_at` datetime NOT NULL,
	CONSTRAINT `document_readings_document_id` PRIMARY KEY(`document_id`)
);
--> statement-breakpoint
CREATE INDEX `document_readings_caregiver_idx` ON `document_readings` (`caregiver_id`);