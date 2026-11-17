CREATE TABLE `invoice_reminders` (
	`invoice_id` varchar(36) NOT NULL,
	`stage` enum('BEFORE','DUE','OVERDUE') NOT NULL,
	`sent_at` datetime NOT NULL,
	CONSTRAINT `invoice_reminders_invoice_id_stage_pk` PRIMARY KEY(`invoice_id`,`stage`)
);
