-- Vignette 0.2, two tracks: brings a database made before 0.2 up to the
-- current schema.sql. Apply it with `npm run db:migrate` (your Cloudflare
-- database) or `npm run db:migrate:local`. scripts/migrate.mjs runs only the
-- statements whose column is missing, so a second run, or a database made
-- from the 0.2 schema.sql, reports "already applied" and changes nothing.
ALTER TABLE videos ADD COLUMN camera_offset REAL;
ALTER TABLE videos ADD COLUMN has_raw INTEGER NOT NULL DEFAULT 0;
ALTER TABLE videos ADD COLUMN layout TEXT NOT NULL DEFAULT 'bubble';
ALTER TABLE videos ADD COLUMN bubble TEXT;
ALTER TABLE videos ADD COLUMN raw_screen TEXT;
ALTER TABLE videos ADD COLUMN raw_camera TEXT;
