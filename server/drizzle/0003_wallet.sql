CREATE TABLE `wallet_cash` (
	`currency` text PRIMARY KEY NOT NULL,
	`amount` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_positions` (
	`symbol` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`sub_category` text NOT NULL,
	`currency` text NOT NULL,
	`listing_exchange` text NOT NULL,
	`quantity` real NOT NULL,
	`mark_price` real NOT NULL,
	`cost_basis_price` real NOT NULL,
	`position_value` real NOT NULL,
	`unrealized_pnl` real NOT NULL,
	`fx_rate_to_base` real NOT NULL
);
