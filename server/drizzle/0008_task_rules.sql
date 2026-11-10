CREATE TABLE `task_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account` text NOT NULL,
	`list_id` text NOT NULL,
	`title` text NOT NULL,
	`every` integer NOT NULL,
	`unit` text NOT NULL,
	`anchor_due` text NOT NULL,
	`current_task_id` text,
	`current_due` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
