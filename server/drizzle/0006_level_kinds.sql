ALTER TABLE `research` ADD `suggested_levels` text;--> statement-breakpoint
ALTER TABLE `wallet_levels` ADD `kind` text DEFAULT 'alert' NOT NULL;--> statement-breakpoint
ALTER TABLE `wallet_levels` ADD `research_id` integer;