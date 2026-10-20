CREATE TABLE `ai_usage` (
	`metric` text NOT NULL,
	`day` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`metric`, `day`)
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
