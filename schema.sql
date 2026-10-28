-- Vignette D1 schema for a new install. Safe to run more than once.
-- A database made before 0.2 runs `npm run db:migrate` once instead, which
-- adds the newer columns (see migrations/).
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  duration REAL NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'uploading',
  -- A first upload's multipart id; while a version rendered again uploads (status 'uploading',
  -- the current video still served), JSON {again: true, uploadId, ...the new version's fields}.
  upload_id TEXT,
  created_at INTEGER NOT NULL,
  -- 0.2, two tracks (migrations/0002-two-tracks.sql)
  camera_offset REAL,                     -- seconds the camera started after the screen
  has_raw INTEGER NOT NULL DEFAULT 0,     -- 1 once both originals are stored
  -- How the video was rendered (loop 3, no migration: the columns exist since 0.2's first update):
  -- 'bubble', 'split', 'camera', 'screen', or 'padded:<cream|black|grey|vermilion>'.
  layout TEXT NOT NULL DEFAULT 'bubble',
  bubble TEXT,                            -- JSON {x, y, size, shape}: the bubble's place (shape 'round' or 'square'; none stored means round)
  raw_screen TEXT,                        -- JSON {size, uploadId, ready}: the screen original's upload
  raw_camera TEXT                         -- the same for the camera original
);
