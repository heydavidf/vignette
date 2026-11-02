-- Vignette 0.2, the phone version: adds the column that records a
-- recording's vertical file to a database made before it. Apply it with
-- `npm run db:migrate` (your Cloudflare database) or
-- `npm run db:migrate:local`; scripts/migrate.mjs runs it only where the
-- column is missing, so a database made from the current schema.sql
-- reports "already applied" and changes nothing.
ALTER TABLE videos ADD COLUMN mobile TEXT;
