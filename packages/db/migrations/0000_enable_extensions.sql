-- D1: PostGIS for geospatial discovery (Phase 6).
-- D6: pg_cron for the hold-expiry sweeper (Phase 2), run inside Postgres
-- rather than as a Vercel Cron job -- no deploy target, no auth surface,
-- no retry-triggered double invocation.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_cron;
