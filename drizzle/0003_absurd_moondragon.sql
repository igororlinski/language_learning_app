CREATE TABLE `card_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`name` text NOT NULL,
	`side` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_fields_card_id_idx` ON `card_fields` (`card_id`);--> statement-breakpoint
CREATE TABLE `deck_fields` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`name` text NOT NULL,
	`side` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_fields_deck_id_idx` ON `deck_fields` (`deck_id`);