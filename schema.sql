-- Vignette D1 schema. Safe to run more than once.
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration REAL NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'uploading',
  upload_id TEXT,
  created_at INTEGER NOT NULL
);
