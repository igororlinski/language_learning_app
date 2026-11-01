CREATE TABLE `badges` (
	`id` text PRIMARY KEY NOT NULL,
	`earned_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `study_days` (
	`day` text PRIMARY KEY NOT NULL,
	`answers` integer DEFAULT 0 NOT NULL,
	`goal` integer NOT NULL
);
--> statement-breakpoint
-- Hand-written: every day of the history so far, judged by the rule the streak
-- had before there was a goal — one answer was enough. The study day starts at
-- 4:00 local time, so an answer at 2:00 belongs to the day before.
INSERT INTO `study_days` (`day`, `answers`, `goal`)
SELECT date(`reviewed_at` / 1000, 'unixepoch', 'localtime', '-4 hours'), count(*), 1
FROM `review_logs`
GROUP BY 1;
