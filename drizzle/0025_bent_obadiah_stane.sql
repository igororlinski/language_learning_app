ALTER TABLE `cards` ADD `uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_uid_unique` ON `cards` (`uid`);--> statement-breakpoint
ALTER TABLE `decks` ADD `uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `decks_uid_unique` ON `decks` (`uid`);--> statement-breakpoint
ALTER TABLE `review_logs` ADD `uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `review_logs_uid_unique` ON `review_logs` (`uid`);--> statement-breakpoint
-- Hand-written: every row there was gets its uid now. randomblob() is drawn
-- per row, so each one is different.
UPDATE `decks` SET `uid` = lower(hex(randomblob(16))) WHERE `uid` IS NULL;--> statement-breakpoint
UPDATE `cards` SET `uid` = lower(hex(randomblob(16))) WHERE `uid` IS NULL;--> statement-breakpoint
UPDATE `review_logs` SET `uid` = lower(hex(randomblob(16))) WHERE `uid` IS NULL;