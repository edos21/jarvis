CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sent_notifications` (
	`key` text PRIMARY KEY NOT NULL,
	`sent_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
