CREATE TABLE `deck_field_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`side` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_field_slots_deck_id_idx` ON `deck_field_slots` (`deck_id`);--> statement-breakpoint
ALTER TABLE `decks` DROP COLUMN `new_front_fields`;--> statement-breakpoint
ALTER TABLE `decks` DROP COLUMN `new_back_fields`;