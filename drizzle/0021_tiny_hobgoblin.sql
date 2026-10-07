ALTER TABLE `deck_field_slots` ADD `phonetic_language` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_front_phonetic_language` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `new_back_phonetic_language` text;