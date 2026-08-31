ALTER TABLE `decks` ADD `new_card_placement` text DEFAULT 'mixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_card_order` text DEFAULT 'oldest' NOT NULL;