CREATE TABLE `payment_marks` (
	`payment_id` integer NOT NULL,
	`period` text NOT NULL,
	`paid_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`payment_id`, `period`),
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`amount` real,
	`currency` text NOT NULL,
	`due_day` integer NOT NULL,
	`link` text,
	`account_label` text,
	`account_number` text,
	`active` integer DEFAULT true NOT NULL,
	`created_on` text NOT NULL
);
