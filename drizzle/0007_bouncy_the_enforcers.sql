ALTER TABLE `decks` ADD `new_front_side` text DEFAULT 'front' NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_front_position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_back_side` text DEFAULT 'back' NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_back_position` integer DEFAULT 0 NOT NULL;