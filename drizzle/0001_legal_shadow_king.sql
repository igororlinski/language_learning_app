ALTER TABLE `decks` ADD `new_per_day` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `reviews_per_day` integer DEFAULT 200 NOT NULL;