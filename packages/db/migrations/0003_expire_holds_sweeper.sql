-- D6: holds carry held_until; expiry is a first-class transition, not
-- an implicit timeout. This function is the single source of truth for
-- "expire every stale hold" -- pg_cron schedules it below, and the TS
-- expireHolds() binding (packages/db/src/reservations.ts) calls the
-- exact same function on demand for lazy-expiry-on-read paths and
-- tests. No duplicated logic between SQL and TypeScript.
--
-- FOR UPDATE SKIP LOCKED (the reason D2 picked Drizzle over Prisma in
-- the first place) means a concurrent sweep and a concurrent
-- releaseHold on the same reservation never block each other; whichever
-- gets there first wins and the other sees zero matching rows.
CREATE OR REPLACE FUNCTION expire_stale_holds() RETURNS integer AS $$
DECLARE
  expired_count integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, zone_id FROM reservation
    WHERE status = 'HELD' AND held_until < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE reservation SET status = 'EXPIRED', updated_at = now() WHERE id = r.id;
    UPDATE parking_zone SET held_count = held_count - 1 WHERE id = r.zone_id;
    INSERT INTO parking_event (topic, kind, entity_type, entity_id, occurred_at, payload)
    VALUES (
      'zone:' || r.zone_id,
      'reservation.expired',
      'reservation',
      r.id,
      now(),
      jsonb_build_object('zoneId', r.zone_id)
    );
    expired_count := expired_count + 1;
  END LOOP;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- D6: run inside Postgres via pg_cron rather than Vercel Cron -- no
-- deploy target, no auth surface on an endpoint, and a retried
-- invocation can't double-run it the way an HTTP-triggered job could.
--
-- Conditional on the extension actually being present: 0000 makes
-- pg_cron optional because it has no Windows build, and a local
-- database without it still gets the function above -- expireHolds()
-- calls it directly on read paths and in tests.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('expire-stale-holds', '* * * * *', 'SELECT expire_stale_holds();');
  ELSE
    RAISE WARNING 'pg_cron not installed: expire-stale-holds is not scheduled.';
  END IF;
END
$do$;
