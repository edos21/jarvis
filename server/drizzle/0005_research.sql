CREATE TABLE `research` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`markdown` text,
	`error` text,
	`cost_usd` real,
	`created_at` text NOT NULL,
	`finished_at` text,
	`saved_path` text
);
