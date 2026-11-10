CREATE TABLE `mac_samples` (
	`at` text PRIMARY KEY NOT NULL,
	`cpu_pct` real NOT NULL,
	`mem_pct` real NOT NULL,
	`disk_pct` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_nav` (
	`date` text PRIMARY KEY NOT NULL,
	`total_usd` real NOT NULL,
	`source` text NOT NULL
);
