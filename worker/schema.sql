-- Reference schema aligned with the existing production D1 application tables.
-- Do not run this against production: the tables already exist.

CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER,
  guid TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'Другое',
  source_published_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'published')),
  telegram_message_id INTEGER,
  published_at TEXT,
  FOREIGN KEY (feed_id) REFERENCES feeds(id)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_discovered ON opportunities(discovered_at);
