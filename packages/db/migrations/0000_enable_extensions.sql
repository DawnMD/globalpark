-- D1: PostGIS for geospatial discovery (Phase 6).
CREATE EXTENSION IF NOT EXISTS postgis;

-- D6: pg_cron for the hold-expiry sweeper (Phase 2), run inside Postgres
-- rather than as a Vercel Cron job -- no deploy target, no auth surface,
-- no retry-triggered double invocation.
--
-- Optional rather than required, because pg_cron ships no Windows build:
-- a local Postgres on Windows cannot have it at all, and failing the
-- very first migration there would make the whole database unusable
-- locally over a scheduler. What the sweeper *does* lives in
-- expire_stale_holds() (0003/0004), which packages/db's expireHolds()
-- calls directly -- so without pg_cron holds expire on read rather than
-- on a timer, which is the same lazy-expiry path production already
-- relies on between ticks. 0003 skips scheduling when this is absent.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron unavailable (%): the hold-expiry sweeper will not be scheduled; expireHolds() still expires holds on read.', SQLERRM;
END
$$;
