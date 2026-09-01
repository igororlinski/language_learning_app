ALTER TABLE `decks` ADD `maximum_interval` integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `learning_steps` text DEFAULT '1m 10m' NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `relearning_steps` text DEFAULT '10m' NOT NULL;