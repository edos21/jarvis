CREATE TABLE `google_accounts` (
	`email` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`refresh_token` text NOT NULL,
	`scopes` text NOT NULL,
	`connected_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
