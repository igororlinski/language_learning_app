ALTER TABLE `study_days` ADD `study_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Hand-written: each day's study time from the history, by the same day key
-- as 0026. Answers from before 0024 were never timed and add nothing.
UPDATE `study_days` SET `study_ms` = coalesce((
  SELECT sum(`duration_ms`) FROM `review_logs`
  WHERE date(`reviewed_at` / 1000, 'unixepoch', 'localtime', '-4 hours') = `study_days`.`day`
), 0);
