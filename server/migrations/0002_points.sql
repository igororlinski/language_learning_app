-- The all-time ranking: points (a day's goal, on every day the goal was met)
-- and study time over the phone's whole history. The phone works them out
-- from all its days and sends the totals; the server keeps only a month of
-- days, which is enough for the weekly and monthly rankings.
ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN study_ms INTEGER NOT NULL DEFAULT 0;
