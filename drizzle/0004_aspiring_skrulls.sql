DROP TABLE `deck_fields`;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_front_fields` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_back_fields` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `card_fields` DROP COLUMN `name`;