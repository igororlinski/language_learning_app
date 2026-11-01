-- Accounts are anonymous: a name for friends to see, and the hash of a
-- recovery code that is the only credential there is. The last stats the phone
-- sent ride along on the row — they are one number each, not a history.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  friend_code TEXT NOT NULL UNIQUE,
  -- NULL until the first upload.
  goal INTEGER,
  streak INTEGER NOT NULL DEFAULT 0,
  -- The phone's study day the streak was worked out on (YYYY-MM-DD).
  streak_day TEXT,
  -- JSON array of badge ids.
  badges TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);

-- The phone's `study_days`, the last few weeks of them: one row per study day,
-- keyed by the phone's own local date, overwritten on every upload.
CREATE TABLE days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  answers INTEGER NOT NULL,
  goal INTEGER NOT NULL,
  study_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- Both directions are stored: adding by code makes two people friends at once.
CREATE TABLE friends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE INDEX friends_friend_id_idx ON friends (friend_id);

-- Daily counters for the few things that need a cap: new accounts per IP and
-- wrong friend codes per account. `day` is the UTC date.
CREATE TABLE limits (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, day)
);
