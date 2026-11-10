CREATE TABLE `wallet_levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`price` real NOT NULL,
	`note` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
