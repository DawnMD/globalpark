-- D3's SSE route is topic-scoped per facility, not per zone (an operator
-- dashboard watches a whole facility). 0003 wrote expire_stale_holds()
-- events with a zone-scoped 'zone:<id>' topic, which was never actually
-- what D3/ADR-0004 specify -- correcting it here rather than editing an
-- already-applied migration.
CREATE OR REPLACE FUNCTION expire_stale_holds() RETURNS integer AS $$
DECLARE
  expired_count integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT res.id, res.zone_id, fl.facility_id
    FROM reservation res
    JOIN parking_zone pz ON pz.id = res.zone_id
    JOIN floor fl ON fl.id = pz.floor_id
    WHERE res.status = 'HELD' AND res.held_until < now()
    FOR UPDATE OF res SKIP LOCKED
  LOOP
    UPDATE reservation SET status = 'EXPIRED', updated_at = now() WHERE id = r.id;
    UPDATE parking_zone SET held_count = held_count - 1 WHERE id = r.zone_id;
    INSERT INTO parking_event (topic, kind, entity_type, entity_id, occurred_at, payload)
    VALUES (
      'facility:' || r.facility_id,
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
