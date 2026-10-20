CREATE TABLE `card_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`front_side` text DEFAULT 'front' NOT NULL,
	`front_position` integer DEFAULT 0 NOT NULL,
	`back_side` text DEFAULT 'back' NOT NULL,
	`back_position` integer DEFAULT 0 NOT NULL,
	`front_speech` text,
	`back_speech` text,
	`front_phonetic_language` text,
	`back_phonetic_language` text,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_templates_deck_id_idx` ON `card_templates` (`deck_id`);--> statement-breakpoint
ALTER TABLE `deck_field_slots` ADD `template_id` integer REFERENCES card_templates(id) ON DELETE cascade;--> statement-breakpoint
-- Hand-written: every deck's one default layout becomes its first template,
-- and every empty slot it had moves into it. The deck's own columns stay
-- behind, unread.
INSERT INTO `card_templates` (`deck_id`, `name`, `position`, `front_side`, `front_position`, `back_side`, `back_position`, `front_speech`, `back_speech`, `front_phonetic_language`, `back_phonetic_language`) SELECT `id`, 'Podstawowy', 0, `new_front_side`, `new_front_position`, `new_back_side`, `new_back_position`, `new_front_speech`, `new_back_speech`, `new_front_phonetic_language`, `new_back_phonetic_language` FROM `decks`;--> statement-breakpoint
UPDATE `deck_field_slots` SET `template_id` = (SELECT `id` FROM `card_templates` WHERE `card_templates`.`deck_id` = `deck_field_slots`.`deck_id`);
